import { closuresToReresolve, type KeyChange, testFileId } from "../keys/index.js";
import type { FileChange, InvalidatedPath, Revision, TestFileRef } from "../types/index.js";
import { type SchedulerContext, tryRunner } from "./context.js";
import type { Ledger } from "./ledger.js";

/** Review, inputs for wave 2: "`oldHash === null` is `add`, `newHash === null` is `delete`, else `change`". */
export function toInvalidatedPath(change: FileChange): InvalidatedPath {
  const kind = change.oldHash === null ? "add" : change.newHash === null ? "delete" : "change";
  return { path: change.path, kind };
}

/**
 * Handles one new revision of the worktree, after `reconcile` stored it.
 *
 * Spec 001 D5: "1. invalidates changed paths in the runner and updates the
 * stat cache and reverse index; 2. computes the affected test files and
 * recomputes their keys; 3. looks each new key up in the store [...]; 4.
 * orders the misses". In detail:
 *
 * - `runner.invalidate` with every change;
 * - the environment is recomputed when the runner recreated a project, when
 *   a runner environment file changed, or the installed lockfile or a patch
 *   (review S8);
 * - the test file list is re-read after an add, a delete or a recreate;
 * - `KeyIndex.rekey` for content; closures are fetched again from the runner
 *   for the union of `closuresToReresolve` and `runner.affected` (review: a
 *   rekey alone misses a newly created import target or snapshot);
 * - untracked closure paths are hashed before keying (review B2);
 * - every file whose key may have moved is settled: lookup, then queue.
 */
export async function applyRevision(
  context: SchedulerContext,
  ledger: Ledger,
  revision: Revision,
): Promise<void> {
  const { keys, runner } = context;
  const changes = revision.changes;
  const paths = changes.map((c) => c.path);
  const changed = new Set(paths);
  const structural = changes.some((c) => c.oldHash === null || c.newHash === null);
  const touched = new Map<string, TestFileRef>();
  const touch = (refs: Iterable<TestFileRef>) => {
    for (const ref of refs) touched.set(testFileId(ref), ref);
  };
  const touchKeys = (keyChanges: readonly KeyChange[]) => touch(keyChanges.map((c) => c.testFile));

  const invalidated = await tryRunner(context, "invalidate", () =>
    runner.invalidate(changes.map(toInvalidatedPath)),
  );
  const recreated = new Set(invalidated?.recreatedProjects ?? []);

  if (recreated.size > 0 || paths.some((path) => keys.isEnvironmentInput(path))) {
    const environments = await tryRunner(context, "environment", () => runner.environment());
    if (environments !== null) touchKeys(await keys.setEnvironments(environments));
  }

  const reresolve = new Map<string, TestFileRef>();
  const pick = (refs: Iterable<TestFileRef>) => {
    for (const ref of refs) if (ledger.file(ref)) reresolve.set(testFileId(ref), ref);
  };
  if (structural || recreated.size > 0) {
    const listed = await tryRunner(context, "testFiles", () => runner.testFiles());
    if (listed !== null) {
      const ids = new Set(listed.map(testFileId));
      for (const file of [...ledger.files.values()]) {
        if (!ids.has(file.id)) ledger.removeFile(file);
      }
      for (const ref of listed) {
        if (!ledger.file(ref)) ledger.addFile(ref);
      }
      pick(listed.filter((ref) => !keys.index.closure(ref)));
    }
  }
  for (const file of ledger.files.values()) {
    if (recreated.has(file.ref.project)) reresolve.set(file.id, file.ref);
  }

  const rekeyed = keys.index.rekey(paths);
  touchKeys(rekeyed);
  pick(rekeyed.map((c) => c.testFile));
  const declared = keys.updateDeclaredInputs(changes);
  if (declared !== null) touchKeys(declared);
  const moved = changes.filter((c) => !keys.isDeclaredInput(c.path));
  pick(closuresToReresolve(moved, keys.index.reverse, keys.isDeclaredInput));
  pick((await tryRunner(context, "affected", () => runner.affected(paths))) ?? []);

  const resolved: TestFileRef[] = [];
  for (const ref of reresolve.values()) {
    const keyChanges = await resolveClosure(context, ref);
    if (keyChanges === null) continue;
    touchKeys(keyChanges);
    resolved.push(ref);
  }
  touch(resolved);
  touchKeys(await keys.trackUntracked());
  storeClosures(context, resolved);
  ledger.settle(touched.values(), changed);
}

/** Fetches a test file's closure from the runner and sets it. `null` when the runner failed. */
export async function resolveClosure(
  context: SchedulerContext,
  ref: TestFileRef,
): Promise<KeyChange[] | null> {
  const closure = await tryRunner(context, "closure", () => context.runner.closure(ref));
  return closure === null ? null : context.keys.setClosure(closure);
}

/**
 * Spec 001 D8: "`test_files` (with the newest closure path list, stored once
 * per test file)", which the next worktree keys from at bootstrap.
 */
export function storeClosures(context: SchedulerContext, refs: readonly TestFileRef[]): void {
  const { store, keys } = context;
  store.transaction(() => {
    for (const ref of refs) {
      const closure = keys.index.closure(ref);
      if (!closure) continue;
      store.testFiles.put({
        testFile: ref,
        closure,
        updatedAt: context.now(),
        updatedBy: context.worktreeId,
      });
    }
  });
}
