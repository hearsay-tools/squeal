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
  /** Row 011-356: the pump's loop ended, and its flights and drain with it. */
  | { readonly kind: "pump-ended" }
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

/*
 * Row 011-356 (card 7, decision 3, "The step's interface"): what a step
 * decides, from a closed list. `DECISION_PLACE` places each kind in the
 * step's lock turn or after it: a kind with no place does not compile, and
 * the carry-out switches end in an exhaustive check.
 */

/** Where a decision is carried out: in the step's lock turn, as the step makes it, or after the turn. */
export type DecisionPlace = "turn" | "after";

/**
 * What a scheduler step returns for the loop to carry out (`GLOSSARY.md`,
 * "Scheduler decision"). `T` is the tier and `S` a slow lane's run (its
 * slot): the step names them only through its ports.
 */
export type StepDecision<T = unknown, S = unknown> =
  /**
   * Fly `tier`, started on the admission of lock turn `turn` with the
   * install stamp `stamp`; `slow`, the slow lane's run it is, with its slot
   * (row 011-357).
   */
  | {
      readonly kind: "start-tier";
      readonly tier: T;
      readonly stamp: string;
      readonly turn: number;
      readonly slow?: S;
    }
  /**
   * The yield check after `trigger` (`TierYields.check`: `decideYields`,
   * then its cancels, marks, bounds and `yields` row), taking the results
   * other worktrees stored first when `adopt` (rows 011-51, 011-123, 011-354).
   */
  | { readonly kind: "check-yields"; readonly trigger: Revision | null; readonly adopt: boolean }
  /** Tell the note of the pump's end: the install went (task 001-113), or the runtime (row 011-106). */
  | { readonly kind: "tell"; readonly note: "reinstalled" | "runtime-gone" }
  /** The install went under this scheduler (task 001-113): it stores nothing more. */
  | { readonly kind: "reinstall" }
  /** Apply the queued runner work beside the tiers in flight: it starts in the turn, its tasks take the lock after it. */
  | { readonly kind: "drain" }
  /** Read the install stamp: the next step's `reads.install`. */
  | { readonly kind: "read-install" }
  /** Read the start facts on disk (runtime folder, merge hold): the next step's `reads.probe`. */
  | { readonly kind: "read-probe" }
  /** The install changed under the scheduler: refresh the keys it moved (task 001-109). */
  | { readonly kind: "refresh-install" }
  /** A merge hold ended: reconcile the paths it released before any tier (row 011-72). */
  | { readonly kind: "reconcile" }
  /** Close the runner instance of each of `lanes`, idle on a hold (row 011-211). */
  | { readonly kind: "close-lanes"; readonly lanes: readonly string[] }
  /** Queue the import re-walk's next chunk (row 015-117): the next step's `reads.rewalk`. */
  | { readonly kind: "queue-rewalk" };

/** One entry of `StepDecision`'s kinds. */
export type StepDecisionKind = StepDecision["kind"];

/** Where each decision kind is carried out. */
export const DECISION_PLACE = {
  "start-tier": "turn",
  "check-yields": "turn",
  tell: "turn",
  reinstall: "turn",
  drain: "turn",
  "read-install": "after",
  "read-probe": "after",
  "refresh-install": "after",
  reconcile: "after",
  "close-lanes": "after",
  "queue-rewalk": "after",
} as const satisfies Record<StepDecisionKind, DecisionPlace>;

/** Where `decision` is carried out. */
export function placeOf(decision: StepDecision): DecisionPlace {
  return DECISION_PLACE[decision.kind];
}
