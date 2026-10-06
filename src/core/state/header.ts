import { testFileId } from "../keys/index.js";
import type {
  CheckKey,
  KnownFailure,
  KnownState,
  RevisionNumber,
  StatusHeader,
  Store,
  TestFileCounts,
  TestFileKeyRecord,
  Validity,
  WorktreeId,
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
 * when its baseline completes.
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
  return {
    revision,
    counts,
    testFilesWithoutChecks: countFilesWithoutChecks(states, keys),
    fullSuite: {
      atCurrentRevision: last !== null && last.revision === revision,
      lastCompletedRevision: last?.revision ?? null,
    },
    testFilesListed: keys.length > 0 || last !== null,
    inheritedCount,
  };
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
