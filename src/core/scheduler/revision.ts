import { closuresToReresolve, type KeyChange, testFileId } from "../keys/index.js";
import type { FileChange, InvalidatedPath, Revision, TestFileRef } from "../types/index.js";
import { NOTHING_CHANGED, type SchedulerContext, tryRunner } from "./context.js";
import { type Failures, failed, settleFailures } from "./failures.js";
import type { Ledger } from "./ledger.js";
import { listPaths } from "./notes.js";

/** Review, inputs for wave 2: "`oldHash === null` is `add`, `newHash === null` is `delete`, else `change`". */
export function toInvalidatedPath(change: FileChange): InvalidatedPath {
  const kind = change.oldHash === null ? "add" : change.newHash === null ? "delete" : "change";
  return { path: change.path, kind };
}

/** What the content re-key of a revision found, for the runner part. */
export interface ContentRekey {
  /** Test files whose key moved because a closure path changed content. */
  readonly rekeyed: readonly TestFileRef[];
  /** An environment input changed: the runner's environment is read again. */
  readonly environment: boolean;
}

/**
 * The part of a new revision that needs no runner, run in the transaction
 * that appends the revision.
 *
 * Spec 001 D5: "the revision row, the stat cache flush, the content re-key of
 * every test file referencing a changed path, their `queued` pending phase
 * and the refreshed known states are written in one transaction." Content
 * re-key, declared inputs, and a provisional environment hash for changed
 * environment inputs (config, setup files, installed lockfile), so every
 * file of an affected project moves to a key with no result. Lookups and
 * queueing follow (`Ledger.settle`); the caller commits the ledger.
 */
export function rekeyContent(
  context: SchedulerContext,
  ledger: Ledger,
  revision: Revision,
): ContentRekey {
  const { keys } = context;
  const changes = revision.changes;
  const touched: TestFileRef[] = [];
  const policy = reloadPolicy(context, changes);
  touched.push(...policy.changes.map((c) => c.testFile));
  const rekeyed = keys.index.rekey(changes.map((c) => c.path)).map((c) => c.testFile);
  touched.push(...rekeyed);
  const declared = keys.updateDeclaredInputs(changes);
  if (declared !== null) touched.push(...declared.map((c) => c.testFile));
  const inputs = changes.some((c) => keys.isEnvironmentInput(c.path));
  if (inputs) touched.push(...keys.provisionalEnvironments(changes).map((c) => c.testFile));
  ledger.settle(touched, new Set(changes.map((c) => c.path)));
  return { rekeyed, environment: inputs || policy.environment };
}

/**
 * Applies a policy the revision reloaded (`SchedulerOptions.reloadPolicy`):
 * the key changes of new `inputs` and of a new `env.allowlist`, and whether
 * the environments must be read again.
 */
function reloadPolicy(
  context: SchedulerContext,
  changes: readonly FileChange[],
): { changes: KeyChange[]; environment: boolean } {
  const policy = context.reloadPolicy(changes);
  if (policy === null) return { changes: [], environment: false };
  context.policy = policy;
  return context.keys.setPolicy(policy);
}

/**
 * The runner part of a new revision, after `rekeyContent` stored it.
 *
 * Spec 001 D5: "1. invalidates changed paths in the runner and updates the
 * stat cache and reverse index; 2. computes the affected test files and
 * recomputes their keys; 3. looks each new key up in the store [...]; 4.
 * orders the misses". In detail:
 *
 * - `runner.invalidate` with every change;
 * - the environment is read again when the runner recreated a project, when
 *   an environment input changed, or while a runner failure is outstanding;
 * - the test file list is re-read after an add, a delete, a recreate, or a
 *   failed listing. A failed listing keeps the previous list: nothing is
 *   retired because of it;
 * - closures are fetched again from the runner for files whose content key
 *   moved, the union of `closuresToReresolve` and `runner.affected` (review:
 *   a rekey alone misses a newly created import target or snapshot), every
 *   file of a recreated project, and every blocked file;
 * - untracked closure paths are hashed before keying (review B2);
 * - every file whose key may have moved is settled: lookup, then queue;
 * - a failed environment, invalidation or closure call blocks the files of
 *   its project; with none, the files a previous failure blocked are settled
 *   anew.
 */
export async function applyRevision(
  context: SchedulerContext,
  ledger: Ledger,
  revision: Revision,
  content: ContentRekey,
): Promise<void> {
  const { keys, runner } = context;
  const changes = revision.changes;
  const paths = changes.map((c) => c.path);
  const changed = new Set(paths);
  const structural = changes.some((c) => c.oldHash === null || c.newHash === null);
  const failures: Failures = new Map();
  const touched = new Map<string, TestFileRef>();
  const touch = (refs: Iterable<TestFileRef>) => {
    for (const ref of refs) touched.set(testFileId(ref), ref);
  };
  const touchKeys = (keyChanges: readonly KeyChange[]) => touch(keyChanges.map((c) => c.testFile));
  const retrying = ledger.broken;

  const invalidated = await tryRunner(
    context,
    `invalidate (${listPaths(paths)})`,
    () => runner.invalidate(changes.map(toInvalidatedPath)),
    (reason) => failed(failures, null, reason),
  );
  const recreated = new Set(invalidated?.recreatedProjects ?? []);
  if (recreated.size > 0 || content.environment || retrying) {
    touchKeys(await readEnvironments(context, failures));
  }

  const reresolve = new Map<string, TestFileRef>();
  const pick = (refs: Iterable<TestFileRef>) => {
    for (const ref of refs) if (ledger.file(ref)) reresolve.set(testFileId(ref), ref);
  };
  if (structural || recreated.size > 0 || ledger.listingFailed) {
    pick(await listTestFiles(context, ledger));
  }
  for (const file of ledger.files.values()) {
    if (recreated.has(file.ref.project) || file.blocked !== null) reresolve.set(file.id, file.ref);
  }
  pick(content.rekeyed);
  const moved = changes.filter((c) => !keys.isDeclaredInput(c.path));
  pick(closuresToReresolve(moved, keys.index.reverse, keys.isDeclaredInput));
  pick(
    (await tryRunner(context, `affected (${listPaths(paths)})`, () => runner.affected(paths))) ??
      [],
  );

  touchKeys(await resolveClosures(context, [...reresolve.values()], failures));
  touch(reresolve.values());
  ledger.settle(touched.values(), changed);
  settleFailures(ledger, failures, retrying, changed);
}

/**
 * Before `run --all`, while a runner failure is outstanding: reads the
 * environment, the test file list and the blocked files' closures again, so
 * the request covers what the runner can run now.
 */
export async function retryRunner(context: SchedulerContext, ledger: Ledger): Promise<void> {
  if (!ledger.broken) return;
  const failures: Failures = new Map();
  const touched = (await readEnvironments(context, failures)).map((c) => c.testFile);
  const listed = await listTestFiles(context, ledger);
  const blocked = [...ledger.files.values()].filter((f) => f.blocked !== null).map((f) => f.ref);
  const refs = [...listed, ...blocked];
  touched.push(...(await resolveClosures(context, refs, failures)).map((c) => c.testFile), ...refs);
  ledger.settle(touched, NOTHING_CHANGED);
  settleFailures(ledger, failures, true, NOTHING_CHANGED);
}

export async function readEnvironments(
  context: SchedulerContext,
  failures: Failures,
): Promise<KeyChange[]> {
  const environments = await tryRunner(
    context,
    "environment",
    () => context.runner.environment(),
    (reason) => failed(failures, null, reason),
  );
  return environments === null ? [] : context.keys.setEnvironments(environments);
}

/**
 * Lists test files, adds new ones and forgets the ones that are gone.
 * Returns the new ones and those without a closure. A failed listing keeps
 * the previous list (D5) and is retried with the next revision.
 */
async function listTestFiles(context: SchedulerContext, ledger: Ledger): Promise<TestFileRef[]> {
  const listed = await tryRunner(context, "testFiles", () => context.runner.testFiles());
  ledger.listingFailed = listed === null;
  if (listed === null) return [];
  const ids = new Set(listed.map(testFileId));
  for (const file of [...ledger.files.values()]) {
    if (!ids.has(file.id)) ledger.removeFile(file);
  }
  for (const ref of listed) {
    if (!ledger.file(ref)) ledger.addFile(ref);
  }
  return listed.filter((ref) => !context.keys.index.closure(ref));
}

/** Fetches closures, stores them, and hashes untracked closure paths. Returns the key changes. */
export async function resolveClosures(
  context: SchedulerContext,
  refs: readonly TestFileRef[],
  failures: Failures,
): Promise<KeyChange[]> {
  const changes: KeyChange[] = [];
  const resolved: TestFileRef[] = [];
  for (const ref of refs) {
    const keyChanges = await resolveClosure(context, ref, (reason) =>
      failed(failures, ref.project, reason),
    );
    if (keyChanges === null) continue;
    changes.push(...keyChanges);
    resolved.push(ref);
  }
  changes.push(...(await context.keys.trackUntracked()));
  storeClosures(context, resolved);
  return changes;
}

/** Fetches a test file's closure from the runner and sets it. `null` when the runner failed. */
export async function resolveClosure(
  context: SchedulerContext,
  ref: TestFileRef,
  onFailure?: (reason: string) => void,
): Promise<KeyChange[] | null> {
  const closure = await tryRunner(
    context,
    `closure of ${ref.path}`,
    () => context.runner.closure(ref),
    onFailure,
  );
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
