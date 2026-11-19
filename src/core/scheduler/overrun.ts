import type { EpochMs } from "../types/common.js";
import type { TestFileRef } from "../types/keys.js";
import { isGroupLane } from "../types/scheduler.js";
import type { TierOverrun } from "../types/standing.js";
import type { SchedulerContext } from "./context.js";
import type { Ledger } from "./ledger.js";
import { cancels, laneOf, type Tier } from "./tiers.js";
import type { WakeSlot, Wakes } from "./wakes.js";
import { unfinished } from "./yield-waits.js";

/*
 * Row 011-399 (gh-233, `research/stuck-running.md` shape 1, E1b): a tier
 * whose every unfinished file has run far past its own last-known time no
 * longer holds its lane. A hung file kept a tier of 4 `running` for 121 s
 * while 1,198 files waited (E1b), and up to `runner.timeoutMs` (900 s in the
 * reporters' repository). Squeal cannot tell a hung file from a slow one: it
 * knows only the tier's start and which files ended (`Tier.ended`), so the
 * rule is a multiple of the file's own time with a floor, and the file keeps
 * running to its deadline. Nothing about its result changes.
 */

/** A file counts as overrunning once it has run this many times its last-known duration... */
export const OVERRUN_FACTOR = 10;

/** ...and at least this long; a file with no known duration, this long past its tier's estimate. */
export const OVERRUN_FLOOR_MS = 60_000;

/**
 * The tier's estimate: the longest last-known duration among its files, a
 * file with none counting 0, as `remainder` reads it at the tier's start.
 */
export function tierEstimateMs(tier: Tier): number {
  return Math.max(0, ...tier.files.map(({ file }) => file.durationMs ?? 0));
}

/** How long a file of `tier` with last-known duration `durationMs` runs before it overruns. */
export function overrunAfterMs(tier: Tier, durationMs: number | null): number {
  if (durationMs === null) return tierEstimateMs(tier) + OVERRUN_FLOOR_MS;
  return Math.max(OVERRUN_FACTOR * durationMs, OVERRUN_FLOOR_MS);
}

/**
 * When `tier`'s files are reported as overrunning (row 011-399): when every
 * file of it that has not ended has run `OVERRUN_FACTOR` times its
 * last-known duration and at least `OVERRUN_FLOOR_MS` (with no known
 * duration, `OVERRUN_FLOOR_MS` past the tier's estimate), counted from the
 * tier's start, since the daemon does not know when a file of it started.
 * On the step's calendar: the start is moved by the calendar steps since
 * (`CalendarSteps.since`, row 011-377). `null` when it never does here: no
 * file is left, it is slow, of a group's lane, it was cancelled, or its
 * runner does not cancel a run, so its lane has no second instance (C4
 * step 5, row 011-269). A tier beside another is reported too (row 011-405,
 * review 0.1.567 N1); whether its lane opens an instance is `overrunAt`'s.
 */
export function reportedOverrunAt(context: SchedulerContext, tier: Tier): EpochMs | null {
  const start = steppedStart(context, tier);
  if (start === null || tier.kind === "slow") return null;
  // A cancelled tier is ending: its cancel is forced after the runner's grace (D12).
  if (tier.cancel?.signal.aborted === true) return null;
  if (isGroupLane(tier.lane)) return null;
  const first = tier.files[0]?.file.ref;
  if (first === undefined || !cancels(context, first)) return null;
  const left = unfinished(tier);
  if (left.length === 0) return null;
  const after = Math.max(...left.map(({ file }) => overrunAfterMs(tier, file.durationMs)));
  return (start + after) as EpochMs;
}

/**
 * When `tier` overruns so that its lane's next tier may start beside it
 * (`reportedOverrunAt`): `null` also for a tier beside another, since a
 * lane has at most two instances (C4 step 5, row 011-405).
 */
export function overrunAt(context: SchedulerContext, tier: Tier): EpochMs | null {
  return tier.beside === true ? null : reportedOverrunAt(context, tier);
}

/**
 * `tier`'s start on the calendar now: its stored start moved by the calendar
 * steps since (`CalendarSteps.since`, row 011-377); `null` before it has one.
 * The overrun's threshold, age and deadline all count from it (review
 * 0.1.567 B2).
 */
function steppedStart(context: SchedulerContext, tier: Tier): EpochMs | null {
  const { startedAt } = tier;
  if (startedAt === undefined) return null;
  return (
    context.steps?.since(startedAt as EpochMs, tier.startedStep ?? 0) ?? (startedAt as EpochMs)
  );
}

/** Whether `tier` overruns at `at` (`overrunAt`). */
export function overruns(context: SchedulerContext, tier: Tier, at: EpochMs): boolean {
  const when = overrunAt(context, tier);
  return when !== null && at >= when;
}

/**
 * The lanes whose tier in flight overruns at `at` and that hold no tier
 * beside it: the next tier of each starts beside it, in the lane's second
 * instance (`besideFiles`).
 */
export function overrunLanes(
  context: SchedulerContext,
  inFlight: readonly Tier[],
  at: EpochMs,
): Set<string> {
  const lanes = new Set<string>();
  for (const tier of inFlight) if (overruns(context, tier, at)) lanes.add(tier.lane);
  for (const tier of inFlight) if (tier.beside === true) lanes.delete(tier.lane);
  return lanes;
}

/**
 * When the next tier in flight with a queued fast file in its lane starts
 * to overrun, after `at`; `null` for none. The step wakes then
 * (`StepPorts.overrunWake`), so the lane's next tier starts beside it with
 * no other event.
 */
export function nextOverrun(
  context: SchedulerContext,
  ledger: Ledger,
  inFlight: readonly Tier[],
  at: EpochMs,
): EpochMs | null {
  let next: EpochMs | null = null;
  const besideHeld = new Set(inFlight.filter((t) => t.beside === true).map((t) => t.lane));
  for (const tier of inFlight) {
    if (besideHeld.has(tier.lane)) continue;
    const when = overrunAt(context, tier);
    if (when === null || when <= at || (next !== null && when >= next)) continue;
    const inLane = (ref: TestFileRef) => laneOf(context, ref) === tier.lane;
    if (ledger.queue.hasFast(inLane)) next = when;
  }
  return next;
}

/**
 * What the `yields` row says of `tier`, overrunning since `at`: its start
 * moved by the calendar steps since, the run's deadline, `runner.timeoutMs`
 * from that start, and its files that have not ended, each with its
 * last-known duration. All three times are on one basis (review 0.1.567 B2).
 */
function tierOverrun(context: SchedulerContext, tier: Tier, at: EpochMs): TierOverrun {
  const { timeoutMs } = context.policy.runner;
  const startedAt = steppedStart(context, tier) ?? at;
  const deadline = timeoutMs === null ? null : ((startedAt + timeoutMs) as EpochMs);
  const files = unfinished(tier).map(({ file }) => ({ ...file.ref, usualMs: file.durationMs }));
  return { startedAt, at, deadline, files, ...(tier.beside === true ? { beside: true } : {}) };
}

/**
 * The tiers in flight that overrun, by run id, as `TierYields` publishes
 * them in the `yields` row, and when each other tier will: its own wake in
 * the scheduler's loop (reason `yield-bound`) checks the tiers again then,
 * with no other event (row 011-399). Each delay is stated from a reading
 * the caller took (a tier's start, a check's): this reads no clock.
 */
export class Overruns {
  readonly #published = new Map<string, TierOverrun>();
  readonly #bounds = new Map<string, EpochMs>();
  #wake: WakeSlot | null = null;

  constructor(
    private readonly wakes: Wakes,
    private readonly recheck: () => void,
  ) {}

  get published(): ReadonlyMap<string, TierOverrun> {
    return this.#published;
  }

  /** `tier` started: the wake comes when it would overrun, from its start's reading. */
  started(context: SchedulerContext, tier: Tier): void {
    const when = reportedOverrunAt(context, tier);
    if (when === null || tier.startedAt === undefined) return;
    this.#bounds.set(tier.runId, when);
    this.#arm(tier.startedAt as EpochMs);
  }

  /**
   * Records which of `tiers` overrun at `at`, and when each other will;
   * whether the published ones changed.
   */
  check(context: SchedulerContext, tiers: readonly Tier[], at: EpochMs): boolean {
    let changed = false;
    for (const tier of tiers) {
      const when = reportedOverrunAt(context, tier);
      if (when === null || when > at) {
        if (when === null) this.#bounds.delete(tier.runId);
        else this.#bounds.set(tier.runId, when);
        changed = this.#published.delete(tier.runId) || changed;
        continue;
      }
      this.#bounds.delete(tier.runId);
      if (this.#published.has(tier.runId)) continue;
      this.#published.set(tier.runId, tierOverrun(context, tier, when));
      changed = true;
    }
    this.#arm(at);
    return changed;
  }

  /** `tier` ended: whether it was published. */
  ended(tier: Tier): boolean {
    if (this.#bounds.delete(tier.runId) && this.#bounds.size === 0) this.#wake?.clear();
    return this.#published.delete(tier.runId);
  }

  /**
   * The calendar stepped `ms` (row 011-377): each bound moves, and each
   * published overrun's start, threshold and deadline with it (review 0.1.567
   * B2); the wake counts elapsed time. Whether a published one moved, so the
   * row is written again.
   */
  shift(ms: number): boolean {
    for (const [runId, at] of this.#bounds) this.#bounds.set(runId, (at + ms) as EpochMs);
    for (const [runId, o] of this.#published)
      this.#published.set(runId, {
        ...o,
        startedAt: (o.startedAt + ms) as EpochMs,
        at: (o.at + ms) as EpochMs,
        deadline: o.deadline === null ? null : ((o.deadline + ms) as EpochMs),
      });
    return ms !== 0 && this.#published.size > 0;
  }

  close(): void {
    this.#bounds.clear();
    this.#wake?.clear();
  }

  /** States the wake at the earliest bound from `at`, a reading the caller took; none without one. */
  #arm(at: EpochMs): void {
    this.#wake ??= this.wakes.slot("yield-bound", () => this.recheck());
    if (this.#bounds.size === 0) this.#wake.clear();
    else this.#wake.after(Math.min(...this.#bounds.values()) - at);
  }
}
