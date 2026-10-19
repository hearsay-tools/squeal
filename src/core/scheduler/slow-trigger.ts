import { readTurn } from "../delivery/turn.js";
import { CONSUMER_EXPIRY_MS, type EpochMs, type Store, type WorktreeId } from "../types/index.js";
import type { SchedulerContext } from "./context.js";

/**
 * Spec 004 D2 trigger (a) by `slow.trigger`: under `"continuous"` the latest
 * revision is `slow.quietMs` old (the fast lane's being done is
 * `SlowTier.#fastFirst`), whether or not a consumer is in a turn; under
 * `"idle"` no consumer is in a turn (`consumersIdle`).
 */
export function policyTriggered(context: SchedulerContext): boolean {
  if (context.policy.slow.trigger === "idle") {
    return consumersIdle(context.store, context.worktreeId, context.now());
  }
  return (quietLeftMs(context) ?? 0) <= 0;
}

/**
 * Under `slow.trigger: "continuous"`, how long until the latest revision is
 * `slow.quietMs` old, at most 0 once it is; `null` under `"idle"`. A
 * worktree with no revision yet is quiet.
 */
export function quietLeftMs(context: SchedulerContext): number | null {
  const { trigger, quietMs } = context.policy.slow;
  if (trigger === "idle") return null;
  const latest = context.store.revisions.latest(context.worktreeId);
  return latest === null ? 0 : latest.createdAt + quietMs - context.now();
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
