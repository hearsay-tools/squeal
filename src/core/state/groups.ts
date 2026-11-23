import { newestCommitReport } from "../commit/store.js";
import { commitLine } from "../commit/text.js";
import { heldUntilAsked } from "../daemon/check-groups.js";
import { readPolicy } from "../daemon/policy.js";
import { testFileId } from "../keys/reverse-index.js";
import { publishedBatches } from "../scheduler/promotions-row.js";
import { groupView } from "../scheduler/slow.js";
import { stopWaitBoundMs } from "../slow/stop-wait.js";
import type { CheckMoment } from "../types/check-groups.js";
import type { EpochMs, WorktreeId } from "../types/common.js";
import type { TestFileRef } from "../types/keys.js";
import type { Policy } from "../types/policy.js";
import { TESTS_GROUP } from "../types/scheduler.js";
import type { KnownState } from "../types/state.js";
import type { CommitLine, GroupTierState } from "../types/status.js";
import type { Store } from "../types/store.js";
import type { TestFileKeyRecord } from "../types/store-records.js";
import { fileClassOf } from "./file-class.js";
import { type LaneFiles, laneChecks, laneCounts, liveActivity, slowPolicyView } from "./slow.js";

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
 * Row 019-49 (spec 019 D6, "No test group at `edit`"): whether a test group
 * runs after an edit. A `checks` test group at `edit` counts by its moment;
 * a default group only while it owns one of the `listed` files, the `tests`
 * group also while none is listed (`groupsCoverage`). Without one, nothing
 * runs between edits, so silence between edits is not a pass.
 */
export function testsAtEdit(policy: Policy, listed: readonly TestFileKeyRecord[]): boolean {
  const view = groupView(policy);
  const owns = (name: string) => listed.some((row) => view.of(row.testFile).name === name);
  return view.groups.some(
    (group) =>
      group.at === "edit" &&
      group.select.kind !== "lint" &&
      (group.index !== null ||
        (group.name === TESTS_GROUP && listed.length === 0) ||
        owns(group.name)),
  );
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
  return groupTiersOf(store, worktreeId, keys, groupLaneCounts(states, keys, policy));
}

/** A configured test group's lane without its activity (`laneCounts`), and what tells its files. */
export interface GroupLaneCounts {
  readonly name: string;
  readonly inLane: (testFile: TestFileRef) => boolean;
  /** The group's tier state up to its lane's activity, in `readGroupTiers`' key order. */
  readonly head: Omit<GroupTierState, "activity" | "stopWaitMs">;
  readonly stopWaitMs?: number;
}

/**
 * `readGroupTiers` without the lanes' activity: a function of `states`,
 * `keys` and `policy` alone, so a caller that keeps them may keep this too
 * (row 011-345).
 */
export function groupLaneCounts(
  states: readonly KnownState[],
  keys: readonly TestFileKeyRecord[],
  policy: Policy,
): readonly GroupLaneCounts[] {
  const view = groupView(policy);
  const waitMs = stopWaitBoundMs(policy);
  return view.groups.flatMap((group) => {
    if (group.index === null || group.select.kind !== "tests") return [];
    const inLane = (ref: TestFileRef) => view.of(ref) === group;
    return [
      {
        name: group.name,
        inLane,
        head: {
          name: group.name,
          at: group.at,
          after: group.after,
          quietMs: group.quietMs,
          ...laneCounts(states, keys, inLane, classifyGroupFiles),
        },
        ...(group.stopRequires ? { stopWaitMs: waitMs } : {}),
      },
    ];
  });
}

/** Each group's tier state from its kept lane (`groupLaneCounts`) and its activity read now. */
export function groupTiersOf(
  store: Store,
  worktreeId: WorktreeId,
  keys: readonly TestFileKeyRecord[],
  lanes: readonly GroupLaneCounts[],
): readonly GroupTierState[] {
  const requested = requestedOf(store, worktreeId, keys, lanes);
  return lanes.map(({ name, inLane, head, stopWaitMs }) => {
    const asked = requested(head.at, inLane);
    return {
      ...head,
      activity: liveActivity(store, worktreeId, keys, inLane, name),
      ...(stopWaitMs === undefined ? {} : { stopWaitMs }),
      ...(asked === 0 ? {} : { requested: asked }),
    };
  });
}

/**
 * Row 023-67 (dogfood round 8, X2): a group at `commit` or `manual`
 * (`heldUntilAsked`) runs a queued file only when a request asked for it.
 * A narrow request (`squeal status --at <commit> --run`, `squeal run
 * <group> <path>...`) puts its files in a batch the live daemon publishes
 * (`publishedBatches`), so a queued file in one is requested, not waiting
 * for a commit or `squeal run <group>`. Round 8 told "97 pending, waiting
 * for `squeal run browser`" after the call's `--run` had queued the 97.
 */
function requestedOf(
  store: Store,
  worktreeId: WorktreeId,
  keys: readonly TestFileKeyRecord[],
  lanes: readonly GroupLaneCounts[],
): (at: CheckMoment, inLane: (ref: TestFileRef) => boolean) => number {
  if (!lanes.some((lane) => heldUntilAsked(lane.head.at))) return () => 0;
  const daemon = store.worktrees.get(worktreeId)?.daemon ?? null;
  if (daemon === null) return () => 0;
  const batched = publishedBatches(store, worktreeId, daemon.startedAt, Date.now() as EpochMs);
  if (batched.size === 0) return () => 0;
  const queued = keys.filter(
    (row) => row.key !== null && row.pending !== null && batched.has(testFileId(row.testFile)),
  );
  return (at, inLane) =>
    heldUntilAsked(at) ? queued.filter((row) => inLane(row.testFile)).length : 0;
}

/**
 * A configured group's files by class, as the header's test file counts
 * class them (`fileClassOf`): one classification for both (row 019-24,
 * review 0.1.397 S2). A file queued or running again at the key of its
 * current result, as a retry is, is pending, not current; a stale or
 * unknown file is not run. The default `slow` group keeps
 * `classifySlowFiles`, whose readers (its line, Stop) are as before.
 */
export function classifyGroupFiles(
  states: readonly KnownState[],
  keys: readonly TestFileKeyRecord[],
  inLane: (testFile: TestFileRef) => boolean,
): LaneFiles {
  const checks = laneChecks(states, inLane);
  const files: LaneFiles = new Map();
  for (const row of keys) {
    if (!inLane(row.testFile)) continue;
    const id = testFileId(row.testFile);
    const cls = fileClassOf(row, checks.get(id) ?? []);
    files.set(id, {
      ref: row.testFile,
      class: cls === "current" || cls === "pending" ? cls : "notRun",
    });
  }
  return files;
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
  return report === null ? undefined : commitLine(report);
}
