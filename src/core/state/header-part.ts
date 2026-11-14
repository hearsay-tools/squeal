import { testFileId } from "../keys/reverse-index.js";
import type { CheckKey, TestFileRef } from "../types/keys.js";
import type { Policy } from "../types/policy.js";
import type { KnownState, Validity } from "../types/state.js";
import type { SlowPendingCounts, TestFileCounts } from "../types/status.js";
import type { TestFileKeyRecord } from "../types/store-records.js";
import { testFileKeyOf, testFileOf } from "./derive.js";
import { countNotCurrent, type NotCurrentCounts } from "./file-class.js";
import {
  type GroupLaneCounts,
  groupLaneCounts,
  groupTextsShown,
  inGroupLane,
  testsAtEdit,
} from "./groups.js";
import { type LaneCounts, laneCounts, type SlowPolicyView, slowPolicyView } from "./slow.js";

/*
 * Row 011-345: the parts of the header (`readHeader`) made from the
 * worktree's states, its key rows and its policy alone. A caller that keeps
 * all three, as the fallback `status --wait` does while the states marker
 * stays, keeps this part too and reads the rest fresh (`headerWith`).
 */

/** What `readHeader` makes from (states, keys, policy) alone. */
export interface HeaderPart {
  /** The policy it was made under, to tell a kept part from a stale one. */
  readonly policy: Policy | null;
  readonly view: SlowPolicyView | null;
  readonly counted: StateCounts;
  readonly testFilesWithoutChecks: TestFileCounts;
  readonly notCurrent: NotCurrentCounts;
  /** Whether any test file has a key row. */
  readonly listed: boolean;
  readonly slowPending?: SlowPendingCounts;
  /** The slow tier's lane without its activity, when the policy declares slow files and the line is its. */
  readonly slowLane?: LaneCounts;
  /** With a `checks` key: the group lanes without their activity, their pending work, and whether a test group runs at `edit`. */
  readonly groups?: {
    readonly lanes: readonly GroupLaneCounts[];
    readonly lanePending: SlowPendingCounts;
    readonly testsAtEdit: boolean;
  };
}

/**
 * The header's part from `states`, `keys` and `policy`. A caller that passes
 * `isSlow` gets `slowPending` from it whatever the policy says; `openFiles`
 * are counted running (C15).
 */
export function headerPart(
  states: readonly KnownState[],
  keys: readonly TestFileKeyRecord[],
  policy: Policy | null,
  isSlow?: (testFile: TestFileRef) => boolean,
  openFiles?: ReadonlySet<string>,
): HeaderPart {
  const view = policy === null ? null : slowPolicyView(policy);
  const slow = isSlow ?? view?.isSlow;
  const shown = policy !== null && groupTextsShown(policy);
  const slowLane = view === null ? undefined : laneCounts(states, keys, view.isSlow);
  // With a `checks` key, the slow tier's line is the default `slow` group's: none once it owns no listed file.
  const owned = slowLane !== undefined && (slowLane.testFiles > 0 || keys.length === 0 || !shown);
  return {
    policy,
    view,
    counted: countStates(states),
    testFilesWithoutChecks: countFilesWithoutChecks(states, keys),
    notCurrent: countNotCurrent(states, keys, openFiles),
    listed: keys.length > 0,
    ...(slow === undefined ? {} : { slowPending: countSlowPending(states, keys, slow) }),
    ...(owned ? { slowLane } : {}),
    ...(policy !== null && shown
      ? {
          groups: {
            lanes: groupLaneCounts(states, keys, policy),
            lanePending: countSlowPending(states, keys, inGroupLane(policy)),
            testsAtEdit: testsAtEdit(policy, keys),
          },
        }
      : {}),
  };
}

/** The validity counts of a worktree's states, and how many current ones are inherited or imported. */
export interface StateCounts {
  readonly counts: Record<Validity, number>;
  readonly fileLevelCounts: Record<Validity, number>;
  readonly inheritedCount: number;
  readonly inheritedFileLevelCount: number;
  readonly importedCount: number;
}

function countStates(states: readonly KnownState[]): StateCounts {
  const counts: Record<Validity, number> = { current: 0, pending: 0, stale: 0, unknown: 0 };
  const fileLevelCounts: Record<Validity, number> = { ...counts };
  let inheritedCount = 0;
  let inheritedFileLevelCount = 0;
  let importedCount = 0;
  for (const state of states) {
    // Task 001-382: a global setup is no test's check; it counts among known failures only.
    if (state.check.kind === "setup") continue;
    counts[state.validity]++;
    if (state.check.kind === "file") fileLevelCounts[state.validity]++;
    if (state.validity !== "current") continue;
    if (state.origin?.kind === "inherited") {
      inheritedCount++;
      if (state.check.kind === "file") inheritedFileLevelCount++;
    }
    // Spec 018 D4: the hook header's count of imported results.
    if (state.origin?.kind === "imported") importedCount++;
  }
  return { counts, fileLevelCounts, inheritedCount, inheritedFileLevelCount, importedCount };
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

/** How many pending slow files the `Affected checks` line names before counting the rest. */
const SLOW_FILES_NAMED = 3;

/** The pending work of the slow test files, counted as `readHeader` counts all of it. */
function countSlowPending(
  states: readonly KnownState[],
  keys: readonly TestFileKeyRecord[],
  isSlow: (testFile: TestFileRef) => boolean,
): SlowPendingCounts {
  const withChecks = new Set(states.map((s) => testFileKeyOf(s.check)));
  const files = new Map<string, TestFileRef>();
  let checks = 0;
  for (const state of states) {
    const ref = testFileOf(state.check);
    if (state.validity !== "pending" || !isSlow(ref)) continue;
    checks++;
    files.set(testFileKeyOf(state.check), ref);
  }
  let testFilesWithoutChecks = 0;
  for (const row of keys) {
    const id = testFileId(row.testFile);
    if (withChecks.has(id) || !hasKey(row) || row.pending === null || !isSlow(row.testFile)) {
      continue;
    }
    testFilesWithoutChecks++;
    files.set(id, row.testFile);
  }
  const named = [...files.values()]
    .sort((a, b) => a.path.localeCompare(b.path) || a.project.localeCompare(b.project))
    .slice(0, SLOW_FILES_NAMED);
  return {
    testFiles: files.size,
    checks,
    testFilesWithoutChecks,
    ...(named.length === 0 ? {} : { files: named }),
  };
}

/** Task 001-23 widens `TestFileKeyRecord.key` to `CheckKey | null` for unkeyed files. */
function hasKey(row: { readonly key: CheckKey | null }): boolean {
  return row.key !== null;
}
