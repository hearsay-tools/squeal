import type { Revision } from "../types/index.js";
import type { SchedulerContext } from "./context.js";
import type { Ledger } from "./ledger.js";
import { laneOf, type Tier } from "./tiers.js";

/**
 * The estimated wall time a backlog tier selects at most, and at most half
 * of `runner.timeoutMs` (spec 011 C4 step 5 as amended 2026-10-19, task
 * 001-366, `research/backlog-wall-budget.md`; the human chose 120 s). It
 * limits what is selected, not how long the tier runs: a file with no known
 * duration counts 0, the first round is always taken, a file can run slower
 * than it last did, and a tier cut short by the run deadline or a cancel
 * gets a grace before it is forced (review wave 12b, S1).
 */
export const BACKLOG_TIER_BUDGET_MS = 120_000;

/**
 * Whether `revision` cancels a backlog tier in flight (D5 step 5 as
 * amended, task 001-124): its content re-key queued an edit's work in the
 * tier's lane (task 001-140), or it changes an input of the tier, whose
 * results the stability check would discard. An add or a delete cancels
 * through its runner part, which finds what it reaches (`queuesEdit`, task
 * 001-364: a build's hashed outputs that no test file reads cancelled a
 * 200-file tier). An edit no test file reaches lets the tier finish. A
 * revision of editor scratch files only queues no edit's work
 * (`rekeyContent`, row 011-117), so it cancels only a tier that read one.
 */
export function cancelsBacklog(
  context: SchedulerContext,
  ledger: Ledger,
  revision: Revision | null,
  tier: Tier,
): boolean {
  if (queuesEdit(context, ledger, tier)) return true;
  const inputs = new Set(tier.files.flatMap((f) => f.inputs));
  return revision?.changes.some((change) => inputs.has(change.path)) ?? false;
}

/** An edit's work is queued in the lane of `tier`, a backlog tier selected while none was. */
function queuesEdit(context: SchedulerContext, ledger: Ledger, tier: Tier): boolean {
  return ledger.queue.hasRecent((ref) => laneOf(context, ref) === tier.lane);
}

/** `BACKLOG_TIER_BUDGET_MS`, or half of `runner.timeoutMs` when that is less. */
export function backlogBudget(timeoutMs: number | null): number {
  return timeoutMs === null
    ? BACKLOG_TIER_BUDGET_MS
    : Math.min(BACKLOG_TIER_BUDGET_MS, timeoutMs / 2);
}

/**
 * List scheduling's bound on the wall time of files of `sum` and `longest`
 * last-known time over `width` workers, in any start order: `sum / W +
 * (1 − 1/W) × longest` (task 001-366: `max(longest, sum / W)` gave 93 s for
 * a node:test tier that took 168 s).
 */
export function wallEstimate(sum: number, longest: number, width: number): number {
  return sum / width + (1 - 1 / width) * longest;
}

interface WallPart {
  readonly count: number;
  readonly sum: number;
  readonly longest: number;
  readonly width: number;
}

/**
 * A backlog tier's files as they are picked (spec 011 C4 step 5, task
 * 001-366): one per worker the tier runs with, then more while
 * `wallEstimate` of their last-known durations stays within `budget`. Each
 * part (`RunnerAdapter.tierPart`) runs as wide as the narrowest of its
 * files' widths, and the parts run one after another, so their estimates
 * add up (review wave-3 B1); the first round is the first part's, while it
 * is the only part.
 */
export class BacklogWall {
  readonly #parts = new Map<string, WallPart>();
  #first: string | null = null;

  constructor(private readonly budget: number) {}

  /**
   * Whether a file of `durationMs`, `null` when unknown and counted 0, joins
   * a tier where its part runs `width` wide; it is counted when it does.
   */
  take(durationMs: number | null, width: number, part = ""): boolean {
    const was = this.#parts.get(part) ?? { count: 0, sum: 0, longest: 0, width: Infinity };
    const w = Math.max(1, Math.min(was.width, Math.floor(width)));
    const next: WallPart = {
      count: was.count + 1,
      sum: was.sum + (durationMs ?? 0),
      longest: Math.max(was.longest, durationMs ?? 0),
      width: w,
    };
    // The round is the tier's head: it ends once another part joins (review wave-3 re-review).
    const firstRound = (this.#first ?? part) === part && this.#parts.size <= 1 && was.count < w;
    if (!firstRound && this.#estimate(part, next) > this.budget) return false;
    this.#first ??= part;
    this.#parts.set(part, next);
    return true;
  }

  /** The tier's wall estimate with `part` as `next`: its parts' estimates summed. */
  #estimate(part: string, next: WallPart): number {
    let total = wallEstimate(next.sum, next.longest, next.width);
    for (const [name, p] of this.#parts)
      if (name !== part) total += wallEstimate(p.sum, p.longest, p.width);
    return total;
  }
}
