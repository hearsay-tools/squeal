import { newestCommitReport } from "../commit/store.js";
import { commitReportText } from "../commit/text.js";
import { readPolicy } from "../daemon/policy.js";
import { groupView } from "../scheduler/slow.js";
import { STOP_SLOW_WAIT_CAP_MS } from "../slow/stop-wait.js";
import {
  type CommitLine,
  type GroupTierState,
  type KnownState,
  type Policy,
  type Store,
  TESTS_GROUP,
  type TestFileKeyRecord,
  type TestFileRef,
  type WorktreeId,
} from "../types/index.js";
import { readLane, slowPolicyView } from "./slow.js";

/*
 * Spec 019 D5 step 3 and D6 (row 019-16): what headers and status read of a
 * policy's check groups, from the store and the policy alone, as the
 * slow-tier line reads the default `slow` group (004 D8). Nothing here is
 * read without a `checks` key, so no text changes without it (wave 2's
 * contract).
 */

/**
 * Whether a policy's texts carry the per-group lines and the commit line:
 * only with a `checks` key (the coordinator, 2026-11-03: spec Goal 2, "a
 * repository with no new keys behaves as today", wins over Goal 5 here; D5
 * amended). The report is still stored for every commit. The one condition
 * to change if the line is shown to every repository later.
 */
export function groupTextsShown(policy: Policy): boolean {
  return policy.checks.length > 0;
}

/**
 * Each configured test group's lane state, in `checks` order (D6). Lint
 * groups have no test files and no lane yet: they are left out. Stop waits
 * for a group at `stop` up to `stop.slowWaitMs`, which covers every
 * required check (D4 step 2).
 */
export function readGroupTiers(
  store: Store,
  worktreeId: WorktreeId,
  states: readonly KnownState[],
  keys: readonly TestFileKeyRecord[],
  policy: Policy,
): readonly GroupTierState[] {
  const view = groupView(policy);
  const waitMs = Math.max(0, Math.min(policy.stop.slowWaitMs, STOP_SLOW_WAIT_CAP_MS));
  return view.groups.flatMap((group) => {
    if (group.index === null || group.select.kind !== "tests") return [];
    const inLane = (ref: TestFileRef) => view.of(ref) === group;
    return [
      {
        name: group.name,
        at: group.at,
        after: group.after,
        quietMs: group.quietMs,
        ...readLane(store, worktreeId, states, keys, inLane, group.name),
        ...(group.stopRequires ? { stopWaitMs: waitMs } : {}),
      },
    ];
  });
}

/** Whether a group other than `tests` owns `ref` under `policy`: its file runs in a group lane (D3). */
export function inGroupLane(policy: Policy): (ref: TestFileRef) => boolean {
  const view = groupView(policy);
  return (ref) => view.of(ref).name !== TESTS_GROUP;
}

/**
 * The files a wait for an edit's work sets aside, under the policy at the
 * worktree's root: the slow files (004 D9) or, with a `checks` key, every
 * file a group lane owns (spec 019 D3, row 019-16). `undefined` with
 * neither, or without a `worktrees` row.
 */
export function worktreeLaneFiles(
  store: Store,
  worktreeId: WorktreeId,
): ((ref: TestFileRef) => boolean) | undefined {
  const root = store.worktrees.get(worktreeId)?.root;
  if (root === undefined) return undefined;
  const policy = readPolicy(root);
  return policy.checks.length > 0 ? inGroupLane(policy) : slowPolicyView(policy)?.isSlow;
}

/** The newest stored commit report as its line (D5 step 3); `undefined` with none stored. */
export function readCommitLine(store: Store, worktreeId: WorktreeId): CommitLine | undefined {
  const report = newestCommitReport(store.meta, worktreeId);
  return report === null ? undefined : { commit: report.commit, text: commitReportText(report) };
}
