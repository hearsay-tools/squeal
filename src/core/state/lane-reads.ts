import { readAll, slot } from "../delivery/slots.js";
import { isRecord } from "../fs/json.js";
import { type LaneRequests, publishedLaneRequests } from "../scheduler/narrow-asks-row.js";
import { readGroupActivity } from "../slow/state.js";
import type { WorktreeId } from "../types/common.js";
import type { SlowTierActivity } from "../types/status.js";
import { type Store, worktreeMetaKey } from "../types/store.js";
import type { DaemonRecord, WorktreeRecord } from "../types/store-records.js";

/**
 * Row 011-427 (review 0.1.650 S1): what one header read reads of the
 * worktree row and its lanes' published state, each read once, when first
 * asked, and shared by every reader of that header: the policy's root, the
 * on-request files (`onRequestFiles`) and the lane lines (`groupTiersOf`,
 * `liveActivity`). Make one per header read and drop it after: a request or
 * a lane's run changes these with no state write, so a kept one goes stale.
 */
export interface LaneReads {
  /** The worktree's row; `undefined` without one. */
  readonly worktree: () => WorktreeRecord | undefined;
  /** The live daemon's record (`worktree().daemon`); `null` without one. */
  readonly daemon: () => DaemonRecord | null;
  /** The live daemon's published lane requests (`publishedLaneRequests`); none without a daemon. */
  readonly requests: () => LaneRequests;
  /** `group`'s published lane activity (`readGroupActivity`). */
  readonly activity: (group: string) => SlowTierActivity | null;
  /** Whether a registered consumer of the worktree is in a turn (`consumerInTurn`). */
  readonly inTurn: () => boolean;
}

const NO_REQUESTS: LaneRequests = { narrow: new Map(), commit: new Map(), requested: new Set() };

/** A fresh `LaneReads` over `store`: nothing read until asked, then each once. */
export function laneReads(store: Store, worktreeId: WorktreeId): LaneReads {
  const worktree = once(() => store.worktrees.get(worktreeId) ?? undefined);
  const daemon = () => worktree()?.daemon ?? null;
  const activities = new Map<string, SlowTierActivity | null>();
  return {
    worktree,
    daemon,
    requests: once(() => {
      const live = daemon();
      return live === null ? NO_REQUESTS : publishedLaneRequests(store, worktreeId, live.startedAt);
    }),
    activity: (group) => {
      if (!activities.has(group))
        activities.set(group, readGroupActivity(store, worktreeId, group));
      return activities.get(group) ?? null;
    },
    inTurn: once(() => consumerInTurn(store, worktreeId)),
  };
}

function once<T>(read: () => T): () => T {
  let done = false;
  let value: T;
  return () => {
    if (!done) {
      value = read();
      done = true;
    }
    return value;
  };
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
