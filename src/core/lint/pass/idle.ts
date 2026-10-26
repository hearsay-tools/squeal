import { SLOW_RECHECK_MS } from "../../scheduler/slow-tier.js";
import { consumersIdle } from "../../scheduler/slow-trigger.js";
import type { EpochMs, Policy, Store, WorktreeId } from "../../types/index.js";

export interface LintIdleOptions {
  readonly store: Store;
  readonly worktreeId: WorktreeId;
  readonly policy: () => Pick<Policy, "slow">;
  readonly now: () => EpochMs;
  /** The scheduler has an edit's work, a request or a wait in hand (011 C9's use). */
  readonly inUse: () => boolean;
}

/**
 * Spec 017 D5: when stale whole-program files may lint, as 004's slow tier
 * waits for idle (approved 2026-10-26). Under `slow.trigger: "continuous"`
 * the latest revision is `slow.quietMs` old and the scheduler has no work in
 * use; under `"idle"` no consumer is in a turn (`consumersIdle`), looked at
 * again every `SLOW_RECHECK_MS`. The milliseconds until then; 0 now.
 */
export function lintIdleIn(options: LintIdleOptions): () => number {
  return () => {
    const { store, worktreeId } = options;
    const { trigger, quietMs } = options.policy().slow;
    const now = options.now();
    if (trigger === "idle") return consumersIdle(store, worktreeId, now) ? 0 : SLOW_RECHECK_MS;
    const latest = store.revisions.latest(worktreeId);
    const quietLeft = latest === null ? 0 : latest.createdAt + quietMs - now;
    if (quietLeft > 0) return quietLeft;
    return options.inUse() ? SLOW_RECHECK_MS : 0;
  };
}
