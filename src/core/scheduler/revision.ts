import { type KeyChange, testFileId } from "../keys/index.js";
import type {
  FileChange,
  InvalidatedPath,
  RelativePath,
  Revision,
  TestFileRef,
} from "../types/index.js";
import { NOTHING_CHANGED, type SchedulerContext, tryRunner } from "./context.js";
import { type Failures, failed, settleFailures } from "./failures.js";
import type { Ledger } from "./ledger.js";
import { unmatchedInputNotes } from "./notes.js";
import { listTestFilesOf } from "./omitted-test-files.js";
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
  /** An environment input changed: the runner's environment is read again. */
  readonly environment: boolean;
  /** The revision is catch-up (`isCatchUp`): its runner part queues no edit's work either. */
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
 */
export function rekeyContent(
  context: SchedulerContext,
  ledger: Ledger,
  revision: Revision,
): ContentRekey {
  const { keys } = context;
  const changes = revision.changes;
  const paths = new Set(changes.map((c) => c.path));
  const catchUp = isCatchUp(context, ledger, paths);
  // First: a listing reads the tracked files as this revision left them (task 001-132).
  const touched: TestFileRef[] = keys.rekeyListings(changes).map((c) => c.testFile);
  const policy = reloadPolicy(context, ledger, changes);
  touched.push(...policy.changes.map((c) => c.testFile));
  const rekeyed = keys.index.rekey(changes.map((c) => c.path)).map((c) => c.testFile);
  touched.push(...rekeyed);
  const declared = keys.updateDeclaredInputs(changes);
  if (declared !== null) touched.push(...declared.map((c) => c.testFile));
  const inputs = changes.some((c) => keys.isEnvironmentInput(c.path));
  if (inputs) touched.push(...keys.provisionalEnvironments(changes).map((c) => c.testFile));
  const misses = ledger.settle(touched, paths, { keyedAt: revision.number, catchUp });
  quietQueued(context, ledger, misses);
  const recent = touched.filter((ref) => ledger.queue.isRecent(ref));
  return {
    rekeyed,
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
 * Before `run --all`, while a runner failure is outstanding: reads the
 * environment, the test file list and the blocked files' closures again, so
 * the request covers what the runner can run now.
 *
 * It runs under the lock (D5), so its calls are bounded as a runner part's
 * are (task 001-259): a wedged runner holds the lock, and every wait queued
 * behind it, no longer than the bound, and the retry ends as failed.
 */
export async function retryRunner(context: SchedulerContext, ledger: Ledger): Promise<void> {
  if (!ledger.broken) return;
  const bound = runnerPartBound(context);
  const failures: Failures = new Map();
  const touched = (await readEnvironments(context, failures, bound)).map((c) => c.testFile);
  const listed = await listTestFiles(context, ledger, bound);
  const blocked = [...ledger.files.values()].filter((f) => f.blocked !== null).map((f) => f.ref);
  const refs = [...listed, ...blocked];
  touched.push(
    ...(await resolveClosures(context, refs, failures, bound)).map((c) => c.testFile),
    ...refs,
  );
  ledger.settle(touched, NOTHING_CHANGED);
  settleFailures(ledger, failures, true, NOTHING_CHANGED);
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
  return environments === null ? [] : context.keys.setEnvironments(environments);
}

/**
 * Lists test files, adds new ones and forgets the ones that are gone.
 * Returns the new ones and those without a closure. A failed listing keeps
 * the previous list (D5) and is retried with the next revision.
 */
async function listTestFiles(
  context: SchedulerContext,
  ledger: Ledger,
  bound: RunnerPartBound,
): Promise<TestFileRef[]> {
  const listed = await tryRunner(context, "testFiles", () => listTestFilesOf(context, bound));
  return applyListing(context, ledger, listed);
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
  for (const ref of refs) {
    const keyChanges = await resolveClosure(context, ref, bound, (reason) =>
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
  bound: RunnerPartBound,
  onFailure?: (reason: string) => void,
): Promise<KeyChange[] | null> {
  const closure = await tryRunner(
    context,
    `closure of ${ref.path}`,
    () => bound.call(() => context.runner.closure(ref)),
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
