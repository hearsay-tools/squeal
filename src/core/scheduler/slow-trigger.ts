import { readTurn } from "../delivery/turn.js";
import type { ResolvedGroup } from "../types/check-groups.js";
import type { EpochMs, WorktreeId } from "../types/common.js";
import type { Store } from "../types/store.js";
import { CONSUMER_EXPIRY_MS } from "../types/store-records.js";
import type { SchedulerContext } from "./context.js";

/*
 * Spec 019 D1: a group's moment, as its lane's pump reads it. `edit` is
 * the latest revision `quietMs` old, whether or not a consumer is in a turn
 * (with the default `slow` group's `slow.quietMs` under `slow.trigger:
 * "continuous"`, spec 004 D2 as amended 2026-10-18, row 004-80); `pause` and
 * `stop` are no consumer in a turn (`consumersIdle`, today's `"idle"`); and
 * `commit` and `manual` never come by themselves (`heldUntilAsked`): a
 * commit's ask (D5) or a request runs their files, at `manual` a request
 * alone (row 019-47). The order behind other groups (`after`) is the lane's
 * (`SlowTier`).
 */

/** Whether group `group`'s moment holds now. */
export function momentHolds(context: SchedulerContext, group: ResolvedGroup): boolean {
  switch (group.at) {
    case "edit":
      return (quietLeftMs(context, group) ?? 0) <= 0;
    case "pause":
    case "stop":
      return consumersIdle(context.store, context.worktreeId, context.now());
    case "commit":
    case "manual":
      return false;
  }
}

/**
 * At `edit`, how long until the latest revision is `group.quietMs` old, at
 * most 0 once it is; `null` at any other moment. A worktree with no
 * revision yet is quiet.
 */
export function quietLeftMs(context: SchedulerContext, group: ResolvedGroup): number | null {
  if (group.at !== "edit") return null;
  const latest = context.store.revisions.latest(context.worktreeId);
  return latest === null ? 0 : latest.createdAt + group.quietMs - context.now();
}

/**
 * Spec 004 D2 trigger (a) under `"idle"`: no registered consumer of the
 * worktree is in a turn (001 D9). A consumer not heard from or delivered to within
 * `CONSUMER_EXPIRY_MS` counts as absent, as its expiry would remove it.
 */
export function consumersIdle(store: Store, worktreeId: WorktreeId, now: EpochMs): boolean {
  for (const record of store.consumers.list(worktreeId)) {
    const heard = Math.max(record.lastSeenAt, record.lastDeliveredAt ?? 0);
    if (heard < now - CONSUMER_EXPIRY_MS) continue;
    if (readTurn(store, record.consumer).turn === "in-turn") return false;
  }
  return true;
}
