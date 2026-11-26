import { testFileId } from "../keys/reverse-index.js";
import type { CheckKey, TestFileRef } from "../types/keys.js";
import type { Policy } from "../types/policy.js";
import type { KnownState, Validity } from "../types/state.js";
import type { SlowPendingCounts, TestFileCounts } from "../types/status.js";
import type { TestFileKeyRecord } from "../types/store-records.js";
import {
  type NotCurrentCounts,
  notCurrentOf,
  type WorktreeStates,
  worktreeStatesOf,
} from "./file-class.js";
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
  /** Row 011-426: the on-request files it counted (`onRequestFiles`), to tell a kept part from a stale one. */
  readonly onRequest: ReadonlySet<string>;
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
 * are counted running (C15), queued `onRequest` files on request (row
 * 011-426).
 */
export function headerPart(
  states: readonly KnownState[],
  keys: readonly TestFileKeyRecord[],
  policy: Policy | null,
  isSlow?: (testFile: TestFileRef) => boolean,
  openFiles?: ReadonlySet<string>,
  onRequest: ReadonlySet<string> = new Set(),
): HeaderPart {
  return headerPartOf(worktreeStatesOf(states), keys, policy, isSlow, openFiles, onRequest);
}

/** `headerPart` from the worktree's states counted (spec 025 D11, row 025-11). */
export function headerPartOf(
  states: WorktreeStates,
  keys: readonly TestFileKeyRecord[],
  policy: Policy | null,
  isSlow?: (testFile: TestFileRef) => boolean,
  openFiles?: ReadonlySet<string>,
  onRequest: ReadonlySet<string> = new Set(),
): HeaderPart {
  const view = policy === null ? null : slowPolicyView(policy);
  const slow = isSlow ?? view?.isSlow;
  const shown = policy !== null && groupTextsShown(policy);
  const slowLane = view === null ? undefined : laneCounts(states, keys, view.isSlow);
  // With a `checks` key, the slow tier's line is the default `slow` group's: none once it owns no listed file.
  const owned = slowLane !== undefined && (slowLane.testFiles > 0 || keys.length === 0 || !shown);
  return {
    policy,
    onRequest,
    view,
    counted: countStates(states),
    testFilesWithoutChecks: countFilesWithoutChecks(states, keys),
    notCurrent: notCurrentOf(states, keys, openFiles, onRequest),
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

function countStates(states: WorktreeStates): StateCounts {
  const counts: Record<Validity, number> = { current: 0, pending: 0, stale: 0, unknown: 0 };
  const fileLevelCounts: Record<Validity, number> = { ...counts };
  let inheritedCount = 0;
  let inheritedFileLevelCount = 0;
  let importedCount = 0;
  for (const group of states.groups) {
    // Task 001-382: a global setup is no test's check; it counts among known failures only.
    if (group.kind === "setup") continue;
    const n = group.count;
    counts[group.validity] += n;
    if (group.kind === "file") fileLevelCounts[group.validity] += n;
    if (group.validity !== "current") continue;
    if (group.origin?.kind === "inherited") {
      inheritedCount += n;
      if (group.kind === "file") inheritedFileLevelCount += n;
    }
    // Spec 018 D4: the hook header's count of imported results.
    if (group.origin?.kind === "imported") importedCount += n;
  }
  return { counts, fileLevelCounts, inheritedCount, inheritedFileLevelCount, importedCount };
}

/**
 * An unkeyed file (key `null`, its runner could not key it) or a keyed file
 * with no pending phase has never run at its key: `unknown`. A queued or
 * running one is `pending`.
 */
function countFilesWithoutChecks(
  states: WorktreeStates,
  keys: readonly TestFileKeyRecord[],
): TestFileCounts {
  const counts = { pending: 0, unknown: 0 };
  for (const row of keys) {
    if (states.files.has(testFileId(row.testFile))) continue;
    counts[hasKey(row) && row.pending !== null ? "pending" : "unknown"]++;
  }
  return counts;
}

/** How many pending slow files the `Affected checks` line names before counting the rest. */
const SLOW_FILES_NAMED = 3;

/** The pending work of the slow test files, counted as `readHeader` counts all of it. */
function countSlowPending(
  states: WorktreeStates,
  keys: readonly TestFileKeyRecord[],
  isSlow: (testFile: TestFileRef) => boolean,
): SlowPendingCounts {
  const withChecks = states.files;
  const files = new Map<string, TestFileRef>();
  let checks = 0;
  for (const [id, file] of withChecks) {
    if (!isSlow(file.testFile)) continue;
    const pending = Object.values(file.pending).reduce(
      (n, phases) => n + phases.queued + phases.running + phases.none,
      0,
    );
    if (pending === 0) continue;
    checks += pending;
    files.set(id, file.testFile);
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
