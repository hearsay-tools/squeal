import { readPolicy } from "../daemon/policy.js";
import { readAll, slot } from "../delivery/slots.js";
import { isRecord } from "../fs/json.js";
import { testFileId } from "../keys/reverse-index.js";
import { groupView } from "../scheduler/slow.js";
import { slowFiles, slowGlobs } from "../slow/classify.js";
import { readGroupActivity } from "../slow/state.js";
import { stopSlowWaitMs } from "../slow/stop-wait.js";
import type { RevisionNumber, WorktreeId } from "../types/common.js";
import type { TestFileRef } from "../types/keys.js";
import type { Policy } from "../types/policy.js";
import { SLOW_GROUP } from "../types/scheduler.js";
import type { KnownState } from "../types/state.js";
import type { SlowTierActivity, SlowTierState } from "../types/status.js";
import { type Store, worktreeMetaKey } from "../types/store.js";
import type { TestFileKeyRecord } from "../types/store-records.js";
import { testFileOf } from "./derive.js";

/*
 * Spec 004 D8: the slow tier as headers, status and Stop read it from the
 * store and the worktree's policy, with no daemon.
 */

/** A policy's slow files and how long Stop waits for them. */
export interface SlowPolicyView {
  readonly isSlow: (testFile: TestFileRef) => boolean;
  /** Every glob that marks slow files (`slowGlobs`). */
  readonly slowGlobs: readonly string[];
  /** How long Stop waits for slow files (`stopSlowWaitMs`); `null` when it does not. */
  readonly stopWaitMs: number | null;
  /** `stop.maxHolds`, at least 1: how many times Stop may hold a main agent in one turn (019 D4). */
  readonly maxHolds: number;
  /** `slow.trigger: "idle"`: slow files run only when the agent pauses (004-80). */
  readonly pausesOnly: boolean;
}

/**
 * The slow view of `policy`; `null` when it declares no slow file (D1).
 * With a `checks` key a slow file is one the default `slow` group owns: a
 * configured group may own a file marked slow (spec 019 D2), and its line
 * is the group's (row 019-16). The slow tier's line, not the lane: a
 * configured group's file is outside the fast lane too (`slowView`).
 */
export function slowPolicyView(policy: Policy): SlowPolicyView | null {
  const globs = slowGlobs(policy, policy.nodeTest);
  if (globs.length === 0) return null;
  const groups = groupView(policy);
  return {
    isSlow:
      policy.checks.length === 0
        ? slowFiles(policy, policy.nodeTest)
        : (ref) => groups.of(ref).name === SLOW_GROUP,
    slowGlobs: globs,
    stopWaitMs: stopSlowWaitMs(policy),
    maxHolds: Math.max(1, policy.stop.maxHolds),
    pausesOnly: policy.slow.trigger === "idle",
  };
}

/**
 * The slow view of the policy at the worktree's root, from its `worktrees`
 * row; `null` without a row or a slow file declared.
 */
export function worktreeSlowView(store: Store, worktreeId: WorktreeId): SlowPolicyView | null {
  const root = store.worktrees.get(worktreeId)?.root;
  return root === undefined ? null : slowPolicyView(readPolicy(root));
}

/** A lane file's class on its line: `notRun` is any file neither current nor pending. */
export type SlowClass = "current" | "pending" | "notRun";

/** A lane's files by `testFileId`, each with its class (`classifySlowFiles`). */
export type LaneFiles = Map<string, { readonly ref: TestFileRef; readonly class: SlowClass }>;

/**
 * Each listed slow test file by class: `pending` when a check is pending or
 * the file is queued or running without checks, `current` when every check
 * is current, `notRun` otherwise.
 */
export function classifySlowFiles(
  states: readonly KnownState[],
  keys: readonly TestFileKeyRecord[],
  isSlow: (testFile: TestFileRef) => boolean,
): LaneFiles {
  const checks = laneChecks(states, isSlow);
  const files = new Map<string, { ref: TestFileRef; class: SlowClass }>();
  for (const row of keys) {
    if (!isSlow(row.testFile)) continue;
    const id = testFileId(row.testFile);
    const own = checks.get(id) ?? [];
    const cls: SlowClass =
      own.length === 0
        ? row.key !== null && row.pending !== null
          ? "pending"
          : "notRun"
        : own.some((s) => s.validity === "pending")
          ? "pending"
          : own.every((s) => s.validity === "current")
            ? "current"
            : "notRun";
    files.set(id, { ref: row.testFile, class: cls });
  }
  return files;
}

/** The states of the lane's files (`inLane`), by `testFileId`. */
export function laneChecks(
  states: readonly KnownState[],
  inLane: (testFile: TestFileRef) => boolean,
): Map<string, KnownState[]> {
  const checks = new Map<string, KnownState[]>();
  for (const state of states) {
    const ref = testFileOf(state.check);
    if (!inLane(ref)) continue;
    const id = testFileId(ref);
    checks.set(id, [...(checks.get(id) ?? []), state]);
  }
  return checks;
}

/**
 * The slow-tier line's state (D8), read in the caller's transaction. The
 * activity is read as true now (`liveActivity`).
 */
export function readSlowTier(
  store: Store,
  worktreeId: WorktreeId,
  states: readonly KnownState[],
  keys: readonly TestFileKeyRecord[],
  view: SlowPolicyView,
): SlowTierState {
  return {
    ...readLane(store, worktreeId, states, keys, view.isSlow, SLOW_GROUP),
    ...(view.stopWaitMs === null ? {} : { stopWaitMs: view.stopWaitMs }),
    ...(view.stopWaitMs === null || view.maxHolds === 1 ? {} : { maxHolds: view.maxHolds }),
    ...(view.pausesOnly ? { pausesOnly: true as const } : {}),
  };
}

/** What a lane's line counts, without the Stop wait or the moment. */
export type LaneState = Omit<SlowTierState, "stopWaitMs" | "maxHolds" | "pausesOnly">;

/**
 * The files of `group`'s lane by class, the revisions the current ones ran
 * at, and the lane's activity as true now: the slow-tier line's state for
 * the default `slow` group (D8), a configured group's for its line (spec
 * 019 D6, row 019-16). `inLane` tells the lane's files; `classify` classes
 * them, the slow tier's classifier unless a configured group passes its own
 * (row 019-24).
 */
export function readLane(
  store: Store,
  worktreeId: WorktreeId,
  states: readonly KnownState[],
  keys: readonly TestFileKeyRecord[],
  inLane: (testFile: TestFileRef) => boolean,
  group: string,
  classify: typeof classifySlowFiles = classifySlowFiles,
): LaneState {
  const files = classify(states, keys, inLane);
  const counts = { current: 0, pending: 0, notRun: 0 };
  for (const { class: cls } of files.values()) counts[cls]++;
  let currentAt: RevisionNumber | null = null;
  let currentUpTo: RevisionNumber | null = null;
  for (const state of states) {
    if (state.validity !== "current" || state.observedAt === null) continue;
    const id = testFileId(testFileOf(state.check));
    if (files.get(id)?.class !== "current") continue;
    currentAt = currentAt === null ? state.observedAt : Math.min(currentAt, state.observedAt);
    currentUpTo = Math.max(currentUpTo ?? state.observedAt, state.observedAt);
  }
  return {
    testFiles: files.size,
    ...counts,
    currentAt,
    ...(currentUpTo !== null && currentUpTo !== currentAt ? { currentUpTo } : {}),
    activity: liveActivity(store, worktreeId, keys, inLane, group),
  };
}

/**
 * The published activity of `group`'s lane (`readGroupActivity`), as true
 * now; `inLane` tells the lane's files. A "running" one names only the files
 * it names that still run: a run ended since it was published (review wave
 * 2, B1), or some files of an idle tier's run did (004-35); and none when its
 * run started before the live daemon did, so a dead predecessor's (lessons
 * defect 12). A wait for the agent to pause, once no registered consumer is
 * in a turn, is a wait for the fast files pending, or for nothing (lessons
 * defect 11): the daemon publishes again only when it next looks at its slow
 * files, which fast tiers can put off for minutes. `null` when nothing is
 * true of it.
 */
function liveActivity(
  store: Store,
  worktreeId: WorktreeId,
  keys: readonly TestFileKeyRecord[],
  inLane: (testFile: TestFileRef) => boolean,
  group: string,
): SlowTierActivity | null {
  const activity = readGroupActivity(store, worktreeId, group);
  if (activity?.kind === "waiting") {
    if (activity.for !== "idle" || consumerInTurn(store, worktreeId)) return activity;
    const fast = keys.some((row) => row.pending !== null && !inLane(row.testFile));
    return fast ? { kind: "waiting", for: "fast" } : null;
  }
  if (activity === null) return null;
  const daemon = store.worktrees.get(worktreeId)?.daemon ?? null;
  if (daemon !== null && activity.since < daemon.startedAt) return null;
  const running = new Set(
    keys
      .filter((row) => row.pending === "running" && inLane(row.testFile))
      .map((row) => row.testFile.path),
  );
  const [path, ...rest] = (activity.paths ?? [activity.path]).filter((p) => running.has(p));
  if (path === undefined) return null;
  const { since, lastDurationMs } = activity;
  const paths = rest.length === 0 ? {} : { paths: [path, ...rest] };
  return { kind: "running", path, ...paths, since, lastDurationMs };
}

/**
 * Whether a registered consumer of the worktree is in a turn (001 D9), from
 * the turn row `delivery/turn.ts` keeps, read here by its registry key since
 * that module reads the header. Unlike the slow tier's trigger
 * (`consumersIdle`) it has no clock, so a consumer the daemon has not yet
 * expired still counts.
 */
function consumerInTurn(store: Store, worktreeId: WorktreeId): boolean {
  const turns = readAll(store, worktreeMetaKey("turn", worktreeId));
  return store.consumers.list(worktreeId).some((record) => {
    const turn = turns[slot(record.consumer)];
    return isRecord(turn) && turn.turn === "in-turn";
  });
}
