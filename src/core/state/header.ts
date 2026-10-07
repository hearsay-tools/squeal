import { testFileId } from "../keys/index.js";
import {
  awaitingInstallMetaKey,
  type CheckKey,
  type KnownFailure,
  type KnownState,
  type RevisionNumber,
  refinedMetaKey,
  type StatusHeader,
  type Store,
  type TestFileCounts,
  type TestFileKeyRecord,
  type Validity,
  type WorktreeId,
} from "../types/index.js";
import { testFileKeyOf } from "./derive.js";

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
 * pending while the refined revision the daemon recorded (`refinedMetaKey`)
 * is behind it (review wave 4.5, S1).
 *
 * While the worktree waits for an install (`awaitingInstallMetaKey`) nothing
 * was listed or run at the current revision: no checkpoint counts as a
 * listing or as a full suite at it (review wave 11, B1).
 */
export function readHeader(
  store: Store,
  worktreeId: WorktreeId,
  states: readonly KnownState[] = store.knownStates.list(worktreeId),
  keys: readonly TestFileKeyRecord[] = store.testFileKeys.list(worktreeId),
): StatusHeader {
  const revision = store.revisions.latest(worktreeId)?.number ?? 0;
  const counts: Record<Validity, number> = { current: 0, pending: 0, stale: 0, unknown: 0 };
  let inheritedCount = 0;
  for (const state of states) {
    counts[state.validity]++;
    if (state.validity === "current" && state.origin?.kind === "inherited") inheritedCount++;
  }
  const last = store.checkpoints.lastCompleted(worktreeId);
  const refinedRevision = readRefined(store, worktreeId);
  const awaiting = store.meta.get(awaitingInstallMetaKey(worktreeId)) === "true";
  return {
    revision,
    counts,
    testFilesWithoutChecks: countFilesWithoutChecks(states, keys),
    fullSuite: {
      atCurrentRevision: !awaiting && last !== null && last.revision === revision,
      lastCompletedRevision: last?.revision ?? null,
    },
    testFilesListed: keys.length > 0 || (!awaiting && last !== null),
    inheritedCount,
    refinedRevision,
    runnerPartPending: refinedRevision !== null && refinedRevision < revision,
    ...(awaiting ? { awaitingInstall: true } : {}),
  };
}

/** `null` when absent or not a number: a store no daemon of this version refined. */
function readRefined(store: Store, worktreeId: WorktreeId): RevisionNumber | null {
  const raw = store.meta.get(refinedMetaKey(worktreeId));
  const value = raw === null ? Number.NaN : Number(raw);
  return Number.isInteger(value) ? value : null;
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

/** Spec 001 D2 as amended: names the runner part of a revision in headers, status and waits. */
export function runnerPartText(revision: RevisionNumber): string {
  return `the runner part of revision ${revision}`;
}

/**
 * Spec 001 D7: "A checkpoint is one `run --all` or baseline request". Worded
 * as a request that did or did not complete, not as a caveat on the counts
 * (lessons, surprise 7). Delivered headers and status print the same words.
 */
export function fullSuiteText({ revision, fullSuite }: StatusHeader): string {
  if (fullSuite.atCurrentRevision) return `completed at revision ${revision}`;
  return fullSuite.lastCompletedRevision === null
    ? "none completed at any revision"
    : `none completed at revision ${revision}; last completed at revision ${fullSuite.lastCompletedRevision}`;
}

/**
 * An unkeyed file (key `null`, its runner could not key it) or a keyed file
 * with no pending phase has never run at its key: `unknown`. A queued or
 * running one is `pending`.
 */
function countFilesWithoutChecks(
  states: readonly KnownState[],
  keys: readonly TestFileKeyRecord[],
): TestFileCounts {
  const withChecks = new Set(states.map((s) => testFileKeyOf(s.check)));
  const counts = { pending: 0, unknown: 0 };
  for (const row of keys) {
    if (withChecks.has(testFileId(row.testFile))) continue;
    counts[hasKey(row) && row.pending !== null ? "pending" : "unknown"]++;
  }
  return counts;
}

/** Task 001-23 widens `TestFileKeyRecord.key` to `CheckKey | null` for unkeyed files. */
function hasKey(row: { readonly key: CheckKey | null }): boolean {
  return row.key !== null;
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
