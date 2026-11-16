import { CalendarSteps, steppedClock } from "../../scheduler/calendar-steps.js";
import type { Clock } from "../../scheduler/clock.js";
import { SLOW_RECHECK_MS } from "../../scheduler/slow-tier.js";
import { consumersIdle } from "../../scheduler/slow-trigger.js";
import type { EpochMs, WorktreeId } from "../../types/common.js";
import type { Policy } from "../../types/policy.js";
import type { Store } from "../../types/store.js";

/** What `lintPauseIn` reads: the main store's consumers of the worktree. */
export interface LintPauseOptions {
  readonly store: Store;
  readonly worktreeId: WorktreeId;
  readonly now: () => EpochMs;
}

/**
 * Row 019-45 (spec 019 D1): when a lint group at `pause` or `stop` may
 * lint what waits, as a test group at those moments runs (`momentHolds`):
 * no consumer is in a turn (`consumersIdle`), looked at again every
 * `SLOW_RECHECK_MS`, whatever `slow.trigger` says. The milliseconds until
 * then; 0 now.
 */
export function lintPauseIn(options: LintPauseOptions): () => number {
  return () =>
    consumersIdle(options.store, options.worktreeId, options.now()) ? 0 : SLOW_RECHECK_MS;
}

export interface LintIdleOptions {
  readonly store: Store;
  readonly worktreeId: WorktreeId;
  readonly policy: () => Pick<Policy, "slow">;
  /** Row 011-382: calendar time for the revision's age, elapsed time for its steps (`Clock`). */
  readonly clock: Clock;
  /** The scheduler has an edit's work, a request or a wait in hand (011 C9's use). */
  readonly inUse: () => boolean;
}

/**
 * Spec 017 D5: when stale whole-program files may lint, as 004's slow tier
 * waits for idle (approved 2026-10-26). Under `slow.trigger: "continuous"`
 * the latest revision is `slow.quietMs` old and the scheduler has no work in
 * use; under `"idle"` no consumer is in a turn (`consumersIdle`), looked at
 * again every `SLOW_RECHECK_MS`. The milliseconds until then; 0 now.
 *
 * Row 011-382: the quiet counts on elapsed time across a calendar step, as
 * the scheduler's `edit` quiet does (row 011-377, `quietLeftMs`): the
 * revision's age counts from when this wait first saw it, through the steps
 * its clock saw since (`CalendarSteps.local`). Its own steps: a step is seen
 * at the next reading here, so one before this wait first saw the revision
 * is not counted.
 */
export function lintIdleIn(options: LintIdleOptions): () => number {
  const steps = new CalendarSteps();
  const clock = steppedClock(options.clock, steps);
  return () => {
    const { store, worktreeId } = options;
    const { trigger, quietMs } = options.policy().slow;
    const now = clock.now();
    if (trigger === "idle") return consumersIdle(store, worktreeId, now) ? 0 : SLOW_RECHECK_MS;
    const latest = store.revisions.latest(worktreeId);
    const created =
      latest === null ? null : steps.local("revision", String(latest.number), latest.createdAt);
    const quietLeft = created === null ? 0 : created + quietMs - now;
    if (quietLeft > 0) return quietLeft;
    return options.inUse() ? SLOW_RECHECK_MS : 0;
  };
}
