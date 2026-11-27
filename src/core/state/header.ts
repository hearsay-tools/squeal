import { readPolicy } from "../daemon/policy.js";
import { runsVitest } from "../daemon/runner.js";
import { readInstallWait } from "../scheduler/install-wait.js";
import { covers, readRefined } from "../scheduler/refined.js";
import type { RevisionNumber, WorktreeId } from "../types/common.js";
import type { TestFileRef } from "../types/keys.js";
import type { Policy } from "../types/policy.js";
import { SLOW_GROUP } from "../types/scheduler.js";
import type { KnownState } from "../types/state.js";
import type { FullSuiteState, KnownFailure, StatusHeader } from "../types/status.js";
import type { Store } from "../types/store.js";
import type { CheckpointRecord, TestFileKeyRecord } from "../types/store-records.js";
import type { WorktreeStates } from "./file-class.js";
import { groupTiersOf, onRequestFiles, readCommitLine } from "./groups.js";
import { type HeaderPart, headerPart, headerPartOf } from "./header-part.js";
import { type LaneReads, laneReads } from "./lane-reads.js";
import { readOptimizerOff } from "./optimizer-note.js";
import { readRevisionCommit } from "./revision-commit.js";
import { liveActivity, slowTierOf } from "./slow.js";

/**
 * Spec 001 D6: "Every delivered message carries a header [...]. Delivery and
 * status derive these from one shared header reader".
 *
 * Read from the store only, so hooks need no daemon. Counts tally
 * `known_states`, which the daemon keeps classified (see `StateSink.refresh`);
 * test files with a `test_file_keys` row and no known check are counted
 * apart, by class.
 * Revision `0` means no revision has been recorded yet; a full suite
 * completed at revision `0` is a full suite at the current revision until the
 * first revision is recorded. Test files count as listed once a key row or a
 * completed checkpoint exists: a project with no test files at all is listed
 * when its baseline completes. The runner part of the current revision is
 * pending while the refined revision the daemon recorded (`readRefined`)
 * is behind it (review wave 4.5, S1).
 *
 * While the worktree waits for an install (`readInstallWait`) nothing
 * was listed or run at the current revision: no checkpoint counts as a
 * listing or as a full suite at it (review wave 11, B1).
 *
 * When the worktree's policy declares slow files (spec 004 D1, read from
 * the root in its `worktrees` row), the header counts their pending work
 * apart as `slowPending` (D9) and carries the slow-tier line's state as
 * `slowTier` (D8), from the same states and keys. A caller that passes
 * `isSlow` gets `slowPending` from it whatever the policy says.
 *
 * `optimizerOff` is the note that Squeal runs Vitest without the dependency
 * optimizer the newest instance's config turns on (D4, tasks 001-176, 001-181).
 *
 * Every listed test file is counted by class, and the pending ones and the
 * pending tests by phase (011 C6 as amended 2026-10-20, row 011-26); a
 * caller that passes `openFiles`, the `testFileId`s the live daemon's open
 * runs hold, gets them counted running (C15).
 */
export function readHeader(
  store: Store,
  worktreeId: WorktreeId,
  states: readonly KnownState[] = store.knownStates.list(worktreeId),
  keys: readonly TestFileKeyRecord[] = store.testFileKeys.list(worktreeId),
  isSlow?: (testFile: TestFileRef) => boolean,
  openFiles?: ReadonlySet<string>,
): StatusHeader {
  return headerWith(store, worktreeId, keys, (policy, onRequest) =>
    headerPart(states, keys, policy, isSlow, openFiles, onRequest),
  );
}

/**
 * `readHeader` from the worktree's states counted (spec 025 D11, row
 * 025-11): status reads them by SQL (`readWorktreeStates`), never a
 * `KnownState` per check.
 */
export function readHeaderOf(
  store: Store,
  worktreeId: WorktreeId,
  states: WorktreeStates,
  keys: readonly TestFileKeyRecord[],
  openFiles?: ReadonlySet<string>,
): StatusHeader {
  return headerWith(store, worktreeId, keys, (policy, onRequest) =>
    headerPartOf(states, keys, policy, undefined, openFiles, onRequest),
  );
}

/**
 * Row 011-345: the header from the part `partOf` gives for the policy at
 * the worktree's root, made from the worktree's states and `keys`
 * (`headerPart`), and every other input read now: the revision and its
 * commit, the refined revision, the install wait, checkpoints, the policy,
 * the lanes' activity, the commit line and the optimizer note, in the order
 * the header always read them (`test/presence/reads.test.ts`). `readHeader`
 * makes the part each time; a caller that kept the states, the keys, the
 * policy and the on-request files may give the part it made from them. Row
 * 011-426: the on-request files (`onRequestFiles`) are read now, after the
 * policy, since a request or a lane's run changes them with no state write.
 * Row 011-427: the worktree row, the lanes' requests and their activity are
 * read once for this header (`laneReads`), shared by the on-request files
 * and the lane lines, and again by the next header read.
 */
export function headerWith(
  store: Store,
  worktreeId: WorktreeId,
  keys: readonly TestFileKeyRecord[],
  partOf: (policy: Policy | null, onRequest: ReadonlySet<string>) => HeaderPart,
): StatusHeader {
  const reads = laneReads(store, worktreeId);
  const latest = store.revisions.latest(worktreeId);
  const revision = latest?.number ?? 0;
  const commit = readRevisionCommit(store, worktreeId, latest);
  const refinedRevision = readRefined(store, worktreeId);
  const wait = readInstallWait(store, worktreeId);
  const awaiting = wait !== null;
  const last = store.checkpoints.lastCompletedFull(worktreeId);
  const lane = awaiting ? null : laneAfter(store.checkpoints.lastCompleted(worktreeId), last);
  const root = reads.worktree()?.root;
  const policy = root === undefined ? null : readPolicy(root);
  const part = partOf(policy, onRequestFiles(store, worktreeId, keys, policy, reads));
  const { counts, fileLevelCounts, inheritedCount, inheritedFileLevelCount, importedCount } =
    part.counted;
  const optimizerOff = readOptimizerOff(store, worktreeId);
  const runnerPartPending = !covers(refinedRevision, revision);
  return {
    revision,
    ...(commit === undefined ? {} : { commit }),
    counts,
    fileLevelCounts,
    testFilesWithoutChecks: part.testFilesWithoutChecks,
    ...part.notCurrent,
    fullSuite: {
      atCurrentRevision: !awaiting && last !== null && last.revision === revision,
      lastCompletedRevision: last?.revision ?? null,
      ...(lane === null ? {} : { lane }),
    },
    testFilesListed: part.listed || (!awaiting && last !== null),
    inheritedCount,
    inheritedFileLevelCount,
    ...(importedCount === 0 ? {} : { importedCount }),
    refinedRevision,
    runnerPartPending,
    ...listingRunnersField(runnerPartPending, root, policy),
    ...(part.slowPending === undefined ? {} : { slowPending: part.slowPending }),
    ...slowTierField(store, worktreeId, keys, part, reads),
    ...groupFields(store, worktreeId, keys, part, reads),
    ...installFields(wait),
    ...(optimizerOff === undefined ? {} : { optimizerOff }),
  };
}

/** The install wait's fields: awaited, the workspaces it misses, and the command that ends it. */
function installFields(
  wait: ReturnType<typeof readInstallWait>,
): Pick<StatusHeader, "awaitingInstall" | "missingInstalls" | "installCommand"> {
  if (wait === null) return {};
  const missing = wait.workspaces;
  return {
    awaitingInstall: true,
    ...(missing.length > 0 ? { missingInstalls: missing } : {}),
    ...(wait.command === null ? {} : { installCommand: wait.command }),
  };
}

/**
 * The slow-tier line's state when the policy declares slow files (D8). With a
 * `checks` key, none once the listed files are in and the default `slow`
 * group owns none of them: configured groups own every file marked slow,
 * and their lines tell them (spec 019 D2, D6). The part decides which; the
 * activity is read now.
 */
function slowTierField(
  store: Store,
  worktreeId: WorktreeId,
  keys: readonly TestFileKeyRecord[],
  { view, slowLane }: HeaderPart,
  reads: LaneReads,
): Pick<StatusHeader, "slowTier"> {
  if (view === null || slowLane === undefined) return {};
  const activity = liveActivity(store, worktreeId, keys, view.isSlow, SLOW_GROUP, reads);
  return { slowTier: slowTierOf({ ...slowLane, activity }, view) };
}

/**
 * Spec 019 D5, D6 (row 019-16), with a `checks` key only: each configured
 * group's lane state, the pending work of every group lane, and the newest
 * commit report's line.
 */
function groupFields(
  store: Store,
  worktreeId: WorktreeId,
  keys: readonly TestFileKeyRecord[],
  { groups }: HeaderPart,
  reads: LaneReads,
): Pick<StatusHeader, "groupTiers" | "lanePending" | "noTestsAtEdit" | "commitLine"> {
  if (groups === undefined) return {};
  const commitLine = readCommitLine(store, worktreeId);
  return {
    groupTiers: groupTiersOf(store, worktreeId, keys, groups.lanes, reads),
    lanePending: groups.lanePending,
    ...(groups.testsAtEdit ? {} : { noTestsAtEdit: true as const }),
    ...(commitLine === undefined ? {} : { commitLine }),
  };
}

/**
 * Task 004-61: the one-lane checkpoint that completed after the last full
 * one, by lane and revision; `null` when the newest is a full one or none.
 */
function laneAfter(
  latest: CheckpointRecord | null,
  full: CheckpointRecord | null,
): NonNullable<FullSuiteState["lane"]> | null {
  if (latest?.lane === undefined || latest.id === full?.id) return null;
  return { lane: latest.lane, revision: latest.revision };
}

/**
 * Whether anything is pending at the current revision: a check or a test
 * file without checks queued or running, or the runner part of the revision.
 * Status waits and Stop wait on this (D7, D9).
 */
export function isPending(header: StatusHeader): boolean {
  return (
    header.counts.pending + header.testFilesWithoutChecks.pending > 0 ||
    header.runnerPartPending === true
  );
}

/**
 * Whether anything but slow test files is pending: what Stop waits for
 * (spec 004 D9, "Stop never waits for slow files"). As `isPending` when the
 * header holds no `slowPending`. With a `checks` key, the files of every
 * group lane are set aside (`lanePending`, spec 019 D3): a group waiting
 * for its moment is not the edit's work.
 */
export function isFastPending(header: StatusHeader): boolean {
  const slow = header.lanePending ?? header.slowPending;
  const checks = header.counts.pending - (slow?.checks ?? 0);
  const files = header.testFilesWithoutChecks.pending - (slow?.testFilesWithoutChecks ?? 0);
  return checks + files > 0 || header.runnerPartPending === true;
}

/**
 * Row 011-311: while the runner part is `pending`, the runners that list a revision's test
 * files, as headers name them (`listingRunners`). The daemon builds Vitest when `runsVitest`
 * holds (spec 003 D7), and a runner per configured `nodeTest` or `pytest` project.
 */
function listingRunnersField(
  pending: boolean,
  root: string | undefined,
  policy: Policy | null,
): { listingRunners?: readonly string[] } {
  if (!pending || root === undefined || policy === null) return {};
  return {
    listingRunners: [
      ...(runsVitest(root, policy) ? ["Vitest"] : []),
      ...(policy.nodeTest.length > 0 ? ["node:test"] : []),
      ...(policy.pytest.length > 0 ? ["pytest"] : []),
    ],
  };
}

/**
 * Spec 001 D7: "A checkpoint is one `run --all` or baseline request". Worded
 * as a request that did or did not complete, not as a caveat on the counts
 * (lessons, surprise 7); without one it says the counts are for the current
 * revision, so it never reads as nothing being current (lessons, defect 27).
 * "Completed", not "requested": a `run --all` may be running or abandoned.
 * Delivered headers and status print the same words; `command` is how the
 * text names the CLI.
 */
export function fullSuiteText({ revision, fullSuite }: StatusHeader, command: string): string {
  if (fullSuite.atCurrentRevision) return `completed at revision ${revision}`;
  const none =
    fullSuite.lastCompletedRevision === null
      ? "none completed at any revision"
      : `none completed since revision ${fullSuite.lastCompletedRevision}`;
  // Task 004-61: a one-lane checkpoint is named, never counted as a full suite.
  const lane =
    fullSuite.lane === undefined
      ? ""
      : `; only the ${fullSuite.lane.lane} lane completed, at revision ${fullSuite.lane.revision}`;
  return `${none}${lane} (the counts are for revision ${revision}; \`${command} run --all\` requests one)`;
}

/**
 * A known state as a known failure, or `null` when its outcome is not `fail`.
 * Every `fail` counts, whatever its validity: a stale failure is still the
 * last thing known. `revision` stands in for a missing `observedAt`.
 */
export function toKnownFailure(state: KnownState, revision: RevisionNumber): KnownFailure | null {
  if (state.outcome !== "fail") return null;
  return {
    check: state.check,
    outcome: "fail",
    validity: state.validity,
    observedAt: state.observedAt ?? revision,
    summary: state.summary ?? "",
    fingerprint: state.fingerprint ?? "",
    location: state.location,
  };
}
