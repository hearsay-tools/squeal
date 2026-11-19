import type { EpochMs } from "../types/common.js";
import type { TestFileRef } from "../types/keys.js";
import { isGroupLane } from "../types/scheduler.js";
import type { SchedulerContext } from "./context.js";
import type { Ledger } from "./ledger.js";
import { cancels, laneOf, type Tier } from "./tiers.js";
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
 * When `tier` overruns (row 011-399): when every file of it that has not
 * ended has run `OVERRUN_FACTOR` times its last-known duration and at least
 * `OVERRUN_FLOOR_MS` (with no known duration, `OVERRUN_FLOOR_MS` past the
 * tier's estimate), counted from the tier's start, since the daemon does not
 * know when a file of it started. On the step's calendar: the start is
 * moved by the calendar steps since (`CalendarSteps.since`, row 011-377).
 * `null` when it never does here: no file is left, it is slow, of a group's
 * lane or beside another tier, or its runner does not cancel a run, so its
 * lane has no second instance (C4 step 5, row 011-269).
 */
export function overrunAt(context: SchedulerContext, tier: Tier): EpochMs | null {
  const { startedAt } = tier;
  if (startedAt === undefined || tier.kind === "slow" || tier.beside === true) return null;
  if (isGroupLane(tier.lane)) return null;
  const first = tier.files[0]?.file.ref;
  if (first === undefined || !cancels(context, first)) return null;
  const left = unfinished(tier);
  if (left.length === 0) return null;
  const after = Math.max(...left.map(({ file }) => overrunAfterMs(tier, file.durationMs)));
  const start = context.steps?.since(startedAt as EpochMs, tier.startedStep ?? 0) ?? startedAt;
  return (start + after) as EpochMs;
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
