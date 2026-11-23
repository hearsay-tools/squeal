import { existsSync } from "node:fs";
import { readPolicy } from "../core/daemon/policy.js";
import { groupView } from "../core/scheduler/slow.js";
import { readGroupActivity } from "../core/slow/state.js";
import type { AbsolutePath, WorktreeId } from "../core/types/common.js";
import type { TestFileRef } from "../core/types/keys.js";
import type { SlowTierActivity } from "../core/types/status.js";
import type { Store } from "../core/types/store.js";
import type { SideEstimate } from "./status-at-estimate.js";
import { readMainStore } from "./status-at-estimate-named.js";
import type { SideState } from "./status-at-report.js";

/*
 * Row 023-71 (dogfood round 9, Y1; spec 023 D7.3): a named file that has
 * not started reads as queued, never as running, and the call says why it
 * waits only where its daemon publishes that. The lane of a configured
 * group publishes its wait (`publishGroupActivity`: the group's slot, the
 * shared worker pool, the load, the work it runs after, the agent's pause)
 * or its run of other files. The default `tests` group publishes none, nor
 * does a lane on hold or behind runner work: those files read "queued"
 * with no reason.
 */

/** Why a side's queued files wait, as its daemon publishes it. */
export interface SideWaiting {
  /** After "waiting for ", e.g. "the browser group's slot". */
  readonly reason: string;
  /** The wait is for capacity: the group's slot or the shared worker pool. */
  readonly capacity: boolean;
}

/** A side whose named files are all queued, none started (`SideEstimate.waiting`). */
export interface NotStarted {
  /** Why they wait, after "waiting for "; `null`: the daemon publishes no wait. */
  readonly reason: string | null;
  readonly capacity: boolean;
}

/** Row 023-71 (Y1): why files not started have no time: the wait their daemon publishes, if any. */
export function waitingText(waiting: NotStarted, files: number): string {
  const { reason, capacity } = waiting;
  if (reason === null)
    return `not started yet, and the daemon does not say what holds ${files === 1 ? "it" : "them"}`;
  if (!capacity) return `not started, waiting for ${reason}`;
  return reason === POOL_WAIT ? `waiting for ${reason}` : `waiting for capacity (${reason})`;
}

/** A file of the call is queued on the side and has not started. */
export const notStarted = (s: SideState): boolean =>
  s.state === "no result" && s.pending === "queued";

/**
 * A narrowed call's side estimate `own` while none of its `files` started:
 * the time unknown, with `wait`, what the daemon publishes; `own` otherwise.
 */
export function withNotStarted(
  own: SideEstimate | null,
  files: readonly TestFileRef[],
  state: (ref: TestFileRef) => SideState,
  wait: SideWaiting | null | undefined,
): SideEstimate | null {
  if (own === null || files.length === 0 || !files.every((ref) => notStarted(state(ref))))
    return own;
  const waiting = { reason: wait?.reason ?? null, capacity: wait?.capacity ?? false };
  return { ...own, seconds: null, waiting };
}

/** One side: its tree (whose policy groups the files), its daemon, and its call's files not started. */
export interface QueuedFiles {
  readonly root: AbsolutePath | null;
  readonly id: WorktreeId | null;
  readonly queued: readonly TestFileRef[];
}

/**
 * Per side, why its queued files wait; `null` when none is queued, or when
 * the lane of one of their groups publishes no wait. `storeRoot` finds the
 * main store.
 */
export function sideWaits(
  storeRoot: AbsolutePath,
  sides: readonly QueuedFiles[],
): (SideWaiting | null)[] {
  const none = sides.map(() => null);
  if (sides.every((side) => side.queued.length === 0)) return none;
  return readMainStore(storeRoot, none, (store) => sides.map((side) => waitOf(store, side)));
}

function waitOf(store: Store, side: QueuedFiles): SideWaiting | null {
  const { root, id, queued } = side;
  if (root === null || id === null || queued.length === 0 || !existsSync(root)) return null;
  const view = groupView(readPolicy(root));
  const groups = new Set(queued.map((ref) => view.of(ref).name));
  const waits: SideWaiting[] = [];
  for (const group of groups) {
    const wait = waitText(group, readGroupActivity(store, id, group));
    if (wait === null) return null;
    waits.push(wait);
  }
  const reasons = [...new Set(waits.map((w) => w.reason))];
  return { reason: reasons.join("; "), capacity: waits.every((w) => w.capacity) };
}

/**
 * Review 0.1.611 S1: a published wait names what the lane waits for, not who
 * holds it. A `slot` wait is also published when the lane yields one turn
 * to a marked waiter with the slot free; a `pool` refusal can come from a
 * project limit or an admission rule; neither records a holder or the
 * permits in use.
 */
const POOL_WAIT = "capacity from the shared worker pool";

/** The words of a lane's published `activity`; `null` when it publishes none. */
export function waitText(group: string, activity: SlowTierActivity | null): SideWaiting | null {
  if (activity === null) return null;
  if (activity.kind === "running")
    return { reason: `the ${group} group's run of ${activity.path} to end`, capacity: false };
  switch (activity.for) {
    case "slot":
      return { reason: `the ${group} group's slot`, capacity: true };
    case "pool":
      return { reason: POOL_WAIT, capacity: true };
    case "load":
      return { reason: "the host load to drop", capacity: false };
    case "fast":
      return { reason: `the work the ${group} group runs after`, capacity: false };
    case "idle":
      return { reason: "the agent to pause", capacity: false };
  }
}
