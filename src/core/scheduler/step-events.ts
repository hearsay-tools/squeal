import type { Revision } from "../types/revision.js";

/*
 * Row 011-352 (card 7, `research/scheduler-step.md`, decision 2 and "The wake
 * loop"): the scheduler's closed lists. A new event or wake reason is one
 * line here, and the compiler names every `switch` that must handle it.
 * Until the step (row 011-356) the pump reads only "an event came".
 */

/**
 * Why the wake loop runs an owner, in the written order of a pass (`Wakes`):
 * owners due at one time run in this order, never in the host's timer order.
 */
export const WAKE_ORDER = [
  /** A `squeal hold` entry's `until` came (`CommandHold`). */
  "command-hold",
  /** The merge hold polls the index while on hold (`MergeHold`). */
  "merge-hold",
  /** A tier in flight reached its yield bound (`TierYields`). */
  "yield-bound",
  /** An idle slow lane's runner instance closes (`SlowRelease`). */
  "slow-release",
  /** A slow lane looks again: its slot, trigger or load guard (`SlowTier`); configured order, `slow` last. */
  "slow-lane",
  /** A record of backlog slots ends its gather (`SlotRecords`). */
  "slot-gather",
  /** Queued files wait on other worktrees' claims: the store's change marker is read again. */
  "claims",
  /** A runner-part call is past its bound (`RunnerPartBound`). */
  "runner-part-bound",
  /** The pump's own wait for an event or a time ends. */
  "pump",
] as const;

/** One entry of `WAKE_ORDER`. */
export type WakeReason = (typeof WAKE_ORDER)[number];

/**
 * Something the pump must see (`GLOSSARY.md`, "Scheduler event"). Each
 * `#notify` site posts one; until row 011-356 the pump reads only that one
 * came, so the payload is for the step and for tests.
 */
export type SchedulerEvent =
  /** The pump was asked for while it ran: a revision, a request, applied runner work, a resume. */
  | { readonly kind: "asked" }
  /** A backlog slot's run ended; its record follows. */
  | { readonly kind: "slot-ran"; readonly runId: string }
  /** A tier in flight ended: recorded, or put back. */
  | { readonly kind: "tier-ended"; readonly runId: string }
  /** The queued runner work was applied. */
  | { readonly kind: "runner-work-drained" }
  /** A tier's error stopped the pump. */
  | { readonly kind: "stalled" }
  /** The scheduler began its close. */
  | { readonly kind: "closing" }
  /** A wake came. */
  | { readonly kind: "wake"; readonly reason: WakeReason }
  /*
   * Row 011-354: the events the yield check reads (`yieldReach`). Their
   * sites pass them to the check; none is posted to the pump yet.
   */
  /** A reconciliation pass stored `revision`. */
  | { readonly kind: "revision"; readonly revision: Revision }
  /** A runner part was applied (`RunnerWork`'s `applied`). */
  | { readonly kind: "runner-work-applied" }
  /** A promotion or a focus request was taken (`RequestIntake`'s `cutTiers` wake). */
  | { readonly kind: "request-taken" }
  /** A fast tier started; `beside` when it went beside the batch's tier (row 011-269). */
  | { readonly kind: "tier-started"; readonly runId: string; readonly beside: boolean }
  /** The runner named a file of the tier in flight `runId` ended (row 011-54). */
  | { readonly kind: "file-ended"; readonly runId: string };

/** One entry of `SchedulerEvent`'s kinds. */
export type SchedulerEventKind = SchedulerEvent["kind"];

/** The rank of `reason` in a pass: its index in `WAKE_ORDER`. */
export function wakeRank(reason: WakeReason): number {
  return WAKE_ORDER.indexOf(reason);
}
