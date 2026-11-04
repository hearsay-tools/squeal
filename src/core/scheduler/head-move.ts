import { lstat } from "node:fs/promises";
import { join } from "node:path";
import {
  type CommitView,
  deletedTestFiles,
  differingPaths,
  environmentDiffers,
  testTally,
} from "../commit/compute.js";
import { commitLint, lintWaitEnded } from "../commit/lint.js";
import { type CommitReport, isFailedReport } from "../commit/report.js";
import { readCommitReports, replaceCommitReport, writeCommitReports } from "../commit/store.js";
import { changedPaths, committedBlobs } from "../commit/tree.js";
import { resolveCommonDir } from "../fs/index.js";
import { gitHead } from "../status/git-head.js";
import {
  type HeadMove,
  headMoveMetaKey,
  parseHeadMove,
  type RelativePath,
} from "../types/index.js";
import { checkIgnored } from "../watcher/git.js";
import { askCommitGroups, heldTestFile, testWaitEnded } from "./commit-moment.js";
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
 * Spec 019 D5 steps 1 to 4: a pass that is not a watch batch (the idle pass,
 * the tool boundary's `sync`, a rescan after dropped events) reads `HEAD`.
 * Moved since the last look to a commit with no stored report, it runs the
 * commit groups for what the commit changed (row 019-22), then makes the
 * report from the keys of the committed blobs and stores it per SHA; to a
 * commit reported before, that report becomes the newest again, as it was
 * made, and nothing runs. A rebase's watch batches pass through commits
 * that are not its end, so none of them is reported; the next pass reports
 * the new `HEAD` once. `HEAD` unchanged, the newest report may take its one
 * update (`updateCommitReport`). It holds nothing.
 */
export async function reportHeadMove(context: SchedulerContext, ledger: Ledger): Promise<void> {
  rememberHead(context, ledger);
  const head = await gitHead(context.root);
  const before = looked.get(context) ?? null;
  if (head === null) return;
  if (head === before) return updateCommitReport(context, ledger);
  looked.set(context, head);
  const { store, worktreeId } = context;
  const reported = readCommitReports(store.meta, worktreeId)?.reports.find(
    (r) => r.commit === head,
  );
  const report = reported ?? (await commitReport(context, ledger, head, before));
  writeCommitReports(store.meta, worktreeId, head, report);
}

/**
 * Row 019-22 (D5 step 3): once every check the newest report waits for
 * ended, the report of the `HEAD` it names is made again from the same
 * commit, once, and marked updated; a delivery tells it as a change. The
 * update reads the working tree then: a check an edit re-keyed since counts
 * as not determined, never as the commit's. Called by the passes that do
 * not move `HEAD` and after each tier's record.
 */
export async function updateCommitReport(context: SchedulerContext, ledger: Ledger): Promise<void> {
  const { store, worktreeId } = context;
  const row = readCommitReports(store.meta, worktreeId);
  const newest = row?.reports[0];
  if (newest === undefined || !("waiting" in newest) || newest.waiting === undefined) return;
  if (newest.commit !== looked.get(context)) return;
  if (!testWaitEnded(context, ledger, newest.waiting.tests)) return;
  const commonDir = resolveCommonDir(context.root);
  const blobOf = (path: RelativePath) => context.keys.cache.hashOf(path);
  const { lint } = newest.waiting;
  if (commonDir !== null) {
    if (!lintWaitEnded(commonDir, context.policy, worktreeId, lint, newest.revision, blobOf))
      return;
  }
  const again = await commitReport(context, ledger, newest.commit, null, false);
  if (isFailedReport(again)) return replaceCommitReport(store.meta, worktreeId, again);
  const { waiting: _, ...made } = again;
  replaceCommitReport(store.meta, worktreeId, { ...made, updated: true });
}

/**
 * D5 steps 1 and 2 for `commit`, moved to from `before` (`null`: no `HEAD`
 * looked at before); a git error reading its tree is a failed report, with
 * the error. With `asks`, the commit groups run first (`askCommitGroups`),
 * so the files they run count as running.
 */
async function commitReport(
  context: SchedulerContext,
  ledger: Ledger,
  commit: string,
  before: string | null,
  asks = true,
): Promise<CommitReport> {
  const base = { commit, revision: ledger.revision.number, at: context.now() };
  try {
    const view = viewOf(context);
    const committed = await committedBlobs(context.root, commit);
    const differing = await differingPaths(view, committed);
    const deleted = await deletedTestFiles(view, committed);
    const environment = environmentDiffers(view, differing);
    const side = { committed, differing, environment };
    const changed = asks
      ? await changedPaths(context.root, before, commit)
      : new Set<RelativePath>();
    if (asks) askCommitGroups(context, ledger, { changed, differing, environment });
    const commonDir = resolveCommonDir(context.root);
    const lint =
      commonDir === null
        ? undefined
        : commitLint(commonDir, context.policy, context.worktreeId, side, changed);
    const held = heldTestFile(context);
    const tests = testTally(view, differing, deleted, (record) => held(record.testFile));
    const waiting = {
      tests: tests.running.flatMap(({ testFile, key }) =>
        key === null ? [] : [{ project: testFile.project, path: testFile.path, key }],
      ),
      lint: lint?.waiting ?? [],
    };
    const waits = waiting.tests.length > 0 || waiting.lint.length > 0;
    return {
      ...base,
      tests: tests.counts,
      ...(lint === undefined ? {} : { lint: lint.counts }),
      ...(waits ? { waiting } : {}),
    };
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
    knownTestFile: (testFile) => store.testFiles.get(testFile) !== null,
    onDisk: (path) =>
      lstat(join(root, path)).then(
        () => true,
        () => false,
      ),
  };
}
