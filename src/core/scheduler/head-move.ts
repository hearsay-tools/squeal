import { type CommitView, differingPaths, testCounts } from "../commit/compute.js";
import type { CommitReport } from "../commit/report.js";
import { readCommitReports, writeCommitReports } from "../commit/store.js";
import { committedBlobs } from "../commit/tree.js";
import { gitHead } from "../status/git-head.js";
import { type HeadMove, headMoveMetaKey, parseHeadMove } from "../types/index.js";
import { checkIgnored } from "../watcher/git.js";
import type { SchedulerContext } from "./context.js";
import type { Ledger } from "./ledger.js";

/** The `HEAD` the store knew at the ledger's revision: a move recorded at or after it, else the revision's. */
function knownHead(context: SchedulerContext, ledger: Ledger): string | null {
  const { number, head } = ledger.revision;
  const recorded = parseHeadMove(context.store.meta.get(headMoveMetaKey(context.worktreeId)));
  return recorded !== null && recorded.revision >= number ? recorded.head : head;
}

/**
 * Task 001-406: a reconciliation pass that made no revision records `HEAD`
 * when it moved since the last revision or record (a commit, a partial one
 * included), with the dirty flag then. `HEAD` is read from the git dir's
 * files, else from git (row 011-239: a reftable repository); `git status`
 * runs only on a move.
 */
export async function recordHeadMove(context: SchedulerContext, ledger: Ledger): Promise<void> {
  if ((await gitHead(context.root)) === knownHead(context, ledger)) return;
  const seen = await context.head();
  const move: HeadMove = { head: seen.head, dirty: seen.dirty, revision: ledger.revision.number };
  context.store.meta.set(headMoveMetaKey(context.worktreeId), JSON.stringify(move));
}

/** Per scheduler, the last `HEAD` its commit reports looked at (`rememberHead`). */
const looked = new WeakMap<SchedulerContext, string | null>();

/**
 * Row 019-13: before a batch changes the ledger, the `HEAD` the commit
 * reports last looked at, once per scheduler: the stored row's, else the
 * `HEAD` the store knew, so a commit made before this daemon's first pass
 * is still a move.
 */
export function rememberHead(context: SchedulerContext, ledger: Ledger): void {
  if (looked.has(context)) return;
  const row = readCommitReports(context.store.meta, context.worktreeId);
  looked.set(context, row === null ? knownHead(context, ledger) : row.seen);
}

/**
 * Spec 019 D5 steps 2 to 4: a pass that is not a watch batch (the idle pass,
 * the tool boundary's `sync`, a rescan after dropped events) reads `HEAD`.
 * Moved since the last look to a commit with no stored report, it makes one
 * from the keys of the committed blobs and stores it per SHA; to a commit
 * reported before, that report becomes the newest again, as it was made. A
 * rebase's watch batches pass through commits that are not its end, so none
 * of them is reported; the next pass reports the new `HEAD` once. It runs
 * nothing and holds nothing.
 */
export async function reportHeadMove(context: SchedulerContext, ledger: Ledger): Promise<void> {
  rememberHead(context, ledger);
  const head = await gitHead(context.root);
  if (head === null || head === looked.get(context)) return;
  looked.set(context, head);
  const { store, worktreeId } = context;
  const reported = readCommitReports(store.meta, worktreeId)?.reports.find(
    (r) => r.commit === head,
  );
  const report = reported ?? (await commitReport(context, ledger, head));
  writeCommitReports(store.meta, worktreeId, head, report);
}

/** D5 step 2 for `commit`; a git error reading its tree is a failed report, with the error. */
async function commitReport(
  context: SchedulerContext,
  ledger: Ledger,
  commit: string,
): Promise<CommitReport> {
  const base = { commit, revision: ledger.revision.number, at: context.now() };
  try {
    const view = viewOf(context);
    const differing = await differingPaths(view, await committedBlobs(context.root, commit));
    return { ...base, tests: testCounts(view, differing) };
  } catch (error) {
    return { ...base, failed: error instanceof Error ? error.message : String(error) };
  }
}

/** The daemon's own `CommitView`: its stat cache, closures, environment inputs and store. */
function viewOf(context: SchedulerContext): CommitView {
  const { keys, store, worktreeId, root } = context;
  return {
    hashOf: (path) => keys.cache.hashOf(path),
    paths: () => keys.cache.paths(),
    closure: (testFile) => keys.index.closure(testFile)?.paths,
    isEnvironmentInput: (path) => keys.isEnvironmentInput(path),
    ignoredAmong: (paths) => checkIgnored(root, paths),
    testFiles: () => store.testFileKeys.list(worktreeId),
    states: () => store.knownStates.list(worktreeId),
  };
}
