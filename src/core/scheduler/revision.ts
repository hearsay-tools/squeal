import type { KeyChange } from "../keys/key-index.js";
import { testFileId } from "../keys/reverse-index.js";
import { type FetchedPart, recordImportGraph } from "../store/import-edges.js";
import type { RelativePath } from "../types/common.js";
import type { CheckKey, TestFileRef } from "../types/keys.js";
import type { FileChange, Revision } from "../types/revision.js";
import type { InvalidatedPath, RunnerClosure, RunnerEnvironment } from "../types/runner.js";
import { NOTHING_CHANGED, type SchedulerContext, tryRunner } from "./context.js";
import { onlyEditorScratch } from "./editor-scratch.js";
import { type Failures, failed, settleFailures } from "./failures.js";
import type { Ledger } from "./ledger.js";
import { unmatchedInputNotes } from "./notes.js";
import { recordOmittedTestFiles } from "./omitted-test-files.js";
import { quietQueued } from "./quiet.js";
import { type RunnerPartBound, runnerPartBound } from "./runner-work-bound.js";

/** Review, inputs for wave 2: "`oldHash === null` is `add`, `newHash === null` is `delete`, else `change`". */
export function toInvalidatedPath(change: FileChange): InvalidatedPath {
  const kind = change.oldHash === null ? "add" : change.newHash === null ? "delete" : "change";
  return { path: change.path, kind };
}

/** What the content re-key of a revision found, for the runner part. */
export interface ContentRekey {
  /** Test files whose key moved because a closure path changed content. */
  readonly rekeyed: readonly TestFileRef[];
  /**
   * The key each of `rekeyed` held before the revision, by `testFileId`: the
   * stored graph answers `affected` from the walk at that key (row 021-30,
   * `storedAffected`).
   */
  readonly previous?: ReadonlyMap<string, CheckKey | null>;
  /** An environment input changed: the runner's environment is read again. */
  readonly environment: boolean;
  /**
   * The revision is catch-up (`isCatchUp`), or changed only editor scratch
   * files (`onlyEditorScratch`): its runner part queues no edit's work either.
   */
  readonly catchUp?: boolean;
  /**
   * The files the content part left recent: those this revision made so are
   * catch-up instead when the runner part, which lists the test files the
   * revision added, finds it is (`Queue.toCatchUp`, review wave 5, B1).
   */
  readonly recent?: readonly TestFileRef[];
}

/**
 * Spec 011 C4 step 4 as amended 2026-10-20 (task 011-22, the human's
 * threshold): a revision that changes this many keyed paths or more causes
 * no edit's work. On cezar the largest agent revision no build wrote
 * changed 8, the smallest large HEAD move 12 (`research/catch-up.md`).
 */
export const CATCH_UP_KEYED_PATHS = 10;

/**
 * Whether `paths`, what one revision changed, hold `CATCH_UP_KEYED_PATHS`
 * keyed paths: a test file, a path of a closure or a declared input,
 * whatever the revision's trigger (a `git pull`, a checkout, a merge or a
 * daemon start's first pass). The files it re-keys, the edited ones and the
 * runner's direct importers included, are then catch-up: a group between
 * an edit's work and the rest that runs on the backlog's route, which a
 * later edit cancels or runs beside. A test file added since the last
 * listing counts once the runner part lists it, and another added path once
 * a closure or a declared input names it (`applyRunnerPart`, review wave 5,
 * B1).
 */
export function isCatchUp(
  context: SchedulerContext,
  ledger: Ledger,
  paths: ReadonlySet<RelativePath>,
): boolean {
  if (paths.size < CATCH_UP_KEYED_PATHS) return false;
  const { keys } = context;
  const testFiles = new Set([...ledger.files.values()].map((file) => file.ref.path));
  let keyed = 0;
  for (const path of paths) {
    if (
      testFiles.has(path) ||
      keys.isDeclaredInput(path) ||
      keys.index.reverse.referencing([path]).length > 0
    ) {
      keyed += 1;
      if (keyed >= CATCH_UP_KEYED_PATHS) return true;
    }
  }
  return false;
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
 *
 * A revision whose only changes are editor scratch files re-keys as any
 * other, but is catch-up, so neither part queues an edit's work, and starts
 * or restarts no lane's wait for quiet (011 C4 step 5 as amended, row
 * 011-117).
 */
export function rekeyContent(
  context: SchedulerContext,
  ledger: Ledger,
  revision: Revision,
): ContentRekey {
  const { keys } = context;
  const changes = revision.changes;
  const paths = new Set(changes.map((c) => c.path));
  const catchUp = onlyEditorScratch(changes) || isCatchUp(context, ledger, paths);
  // First: a listing reads the tracked files as this revision left them (task 001-132).
  const touched: TestFileRef[] = keys.rekeyListings(changes).map((c) => c.testFile);
  const policy = reloadPolicy(context, ledger, changes);
  touched.push(...policy.changes.map((c) => c.testFile));
  const moved = keys.index.rekey(changes.map((c) => c.path));
  const rekeyed = moved.map((c) => c.testFile);
  touched.push(...rekeyed);
  const declared = keys.updateDeclaredInputs(changes);
  if (declared !== null) touched.push(...declared.map((c) => c.testFile));
  const inputs = changes.some((c) => keys.isEnvironmentInput(c.path));
  if (inputs) touched.push(...keys.provisionalEnvironments(changes).map((c) => c.testFile));
  const misses = ledger.settle(touched, paths, { keyedAt: revision.number, catchUp });
  quietQueued(context, ledger, misses, changes);
  const recent = touched.filter((ref) => ledger.queue.isRecent(ref));
  return {
    rekeyed,
    previous: new Map(moved.map((c) => [testFileId(c.testFile), c.previous])),
    environment: inputs || policy.environment,
    catchUp,
    ...(recent.length > 0 ? { recent } : {}),
  };
}

/**
 * Applies a policy the revision reloaded (`SchedulerOptions.reloadPolicy`):
 * the key changes of new `inputs` and of a new `env.allowlist`, and whether
 * the environments must be read again. Notes the `inputs` entries that
 * select nothing, against the test files known now (review wave 4.5, S5).
 */
function reloadPolicy(
  context: SchedulerContext,
  ledger: Ledger,
  changes: readonly FileChange[],
): { changes: KeyChange[]; environment: boolean } {
  const policy = context.reloadPolicy(changes);
  if (policy === null) return { changes: [], environment: false };
  context.policy = policy;
  const applied = context.keys.setPolicy(policy);
  const testFiles = [...ledger.files.values()].map((file) => file.ref.path);
  for (const text of unmatchedInputNotes(
    context.keys.unmatchedInputs(testFiles),
    testFiles.length,
  )) {
    context.note(text);
  }
  return applied;
}

/**
 * What the runner said to a runner retry before `run --all`, while a runner
 * failure is outstanding (`fetchRunnerRetry`): the environment, the test
 * file list and the closures of the listed files without one and of the
 * blocked files. `null` reads failed, as `failures` says.
 */
export interface RunnerRetry {
  readonly failures: Failures;
  readonly environments: readonly RunnerEnvironment[] | null;
  readonly listed: readonly TestFileRef[] | null;
  /** How many files that listing left out; `null` when it failed. */
  readonly omitted: number | null;
  /** The test files whose closures were asked for. */
  readonly refs: readonly TestFileRef[];
  readonly closures: readonly RunnerClosure[];
}

/**
 * Before `run --all`, while a runner failure is outstanding: reads the
 * environment, the test file list and the blocked files' closures again, so
 * the request covers what the runner can run now. `null` with no failure.
 *
 * It runs under the lock (D5), so its calls are bounded as a runner part's
 * are (task 001-259): a wedged runner holds the lock, and every wait queued
 * behind it, no longer than the bound, and the retry ends as failed.
 *
 * Spec 021 D2 (re-review of 0.1.434, B2): it only asks the runner and
 * writes nothing; `keyRunnerRetry` and `storeRunnerRetry` apply what it
 * read, each tried again on a busy store with the answers kept.
 */
export async function fetchRunnerRetry(
  context: SchedulerContext,
  ledger: Ledger,
): Promise<RunnerRetry | null> {
  if (!ledger.broken) return null;
  const bound = runnerPartBound(context);
  const failures: Failures = new Map();
  const environments = await tryRunner(
    context,
    "environment",
    () => bound.call(() => context.runner.environment()),
    (reason) => failed(failures, null, reason),
  );
  let omitted = 0;
  const listed = await tryRunner(context, "testFiles", async () => {
    const files = await bound.call(() => context.runner.testFiles());
    omitted = context.runner.traits.omittedTestFiles();
    return files;
  });
  // As `applyListing` leaves them: its files without a closure, and the blocked ones it keeps.
  const kept = listed === null ? null : new Set(listed.map(testFileId));
  const blocked = [...ledger.files.values()]
    .filter((file) => file.blocked !== null && (kept === null || kept.has(file.id)))
    .map((file) => file.ref);
  const refs = [...(listed ?? []).filter((ref) => !context.keys.index.closure(ref)), ...blocked];
  const closures: RunnerClosure[] = [];
  for (const ref of refs) {
    const closure = await resolveClosure(context, ref, bound, (reason) =>
      failed(failures, ref.project, reason),
    );
    if (closure !== null) closures.push(closure);
  }
  return {
    failures,
    environments,
    listed,
    omitted: listed === null ? null : omitted,
    refs,
    closures,
  };
}

/**
 * The keys of a runner retry: its environments and closures, and the paths
 * they name hashed. Its writes, the stat cache's and the environment
 * record's, are each a transaction of their own; a busy store's refusal
 * throws, and a call again with the same `retry` writes them then (spec 021
 * D2), with `retouched`, the files a refused call keyed and nothing settled.
 * Returns the test files to settle.
 */
export async function keyRunnerRetry(
  context: SchedulerContext,
  retry: RunnerRetry,
  retouched: readonly TestFileRef[] = [],
): Promise<TestFileRef[]> {
  const { keys } = context;
  const environments = retry.environments;
  const touched = (
    environments === null ? keys.unverifyRuntime([null]) : await keys.setEnvironments(environments)
  ).map((change) => change.testFile);
  for (const closure of retry.closures) {
    touched.push(...keys.setClosure(closure).map((change) => change.testFile));
  }
  touched.push(...(await keys.trackUntracked()).map((change) => change.testFile));
  return [...touched, ...retry.refs, ...retouched];
}

/**
 * The store's part of a runner retry, synchronous, for one store transaction
 * taken before it changes anything (spec 021 D2): the import graph, the
 * listing and what it left out, the closures, and the keys of `touched`
 * settled.
 */
export function storeRunnerRetry(
  context: SchedulerContext,
  ledger: Ledger,
  retry: RunnerRetry,
  touched: readonly TestFileRef[],
): void {
  if (retry.environments !== null) {
    recordImportGraph(context, { environments: retry.environments });
  }
  if (retry.omitted !== null) {
    recordOmittedTestFiles(context.store, context.worktreeId, retry.omitted);
  }
  applyListing(context, ledger, retry.listed);
  const resolved = retry.closures.map((closure) => closure.testFile);
  storeClosures(context, resolved, { closures: retry.closures });
  ledger.settle(touched, NOTHING_CHANGED);
  settleFailures(ledger, retry.failures, true, NOTHING_CHANGED);
}

/** Reads the environments under `bound`; unbounded without one. */
export async function readEnvironments(
  context: SchedulerContext,
  failures: Failures,
  bound?: RunnerPartBound,
): Promise<KeyChange[]> {
  const read = () => context.runner.environment();
  const environments = await tryRunner(
    context,
    "environment",
    () => (bound === undefined ? read() : bound.call(read)),
    (reason) => failed(failures, null, reason),
  );
  if (environments === null) return context.keys.unverifyRuntime([null]);
  const changes = await context.keys.setEnvironments(environments);
  recordImportGraph(context, { environments });
  return changes;
}

/**
 * Applies a listing: `null` is a failed one, which keeps the list. Returns the
 * listed files without a closure.
 */
export function applyListing(
  context: SchedulerContext,
  ledger: Ledger,
  listed: readonly TestFileRef[] | null,
): TestFileRef[] {
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
  bound: RunnerPartBound,
): Promise<KeyChange[]> {
  const changes: KeyChange[] = [];
  const resolved: TestFileRef[] = [];
  const closures: RunnerClosure[] = [];
  for (const ref of refs) {
    const closure = await resolveClosure(context, ref, bound, (reason) =>
      failed(failures, ref.project, reason),
    );
    if (closure === null) continue;
    changes.push(...context.keys.setClosure(closure));
    resolved.push(ref);
    closures.push(closure);
  }
  changes.push(...(await context.keys.trackUntracked()));
  storeClosures(context, resolved, { closures });
  return changes;
}

/** Fetches a test file's closure from the runner. `null` when the runner failed. */
async function resolveClosure(
  context: SchedulerContext,
  ref: TestFileRef,
  bound: RunnerPartBound,
  onFailure?: (reason: string) => void,
): Promise<RunnerClosure | null> {
  const closure = await tryRunner(
    context,
    `closure of ${ref.path}`,
    () => bound.call(() => context.runner.closure(ref)),
    onFailure,
  );
  if (closure === null) context.keys.unverifyRuntime([ref.project]);
  return closure;
}

/**
 * Spec 001 D8: "`test_files` (with the newest closure path list, stored once
 * per test file)", which the next worktree keys from at bootstrap. Spec 015
 * D11: in the same transaction, the import edges of `fetched`'s closures and
 * the environment files of its environments, once keyed.
 */
export function storeClosures(
  context: SchedulerContext,
  refs: readonly TestFileRef[],
  fetched: FetchedPart = {},
): void {
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
    recordImportGraph(context, fetched);
  });
}
