import type { Revision } from "../types/index.js";
import type { SchedulerContext } from "./context.js";
import type { Ledger } from "./ledger.js";
import { laneOf, type Tier } from "./tiers.js";

/**
 * Last-known file time a backlog tier selects at most, and at most half of
 * `runner.timeoutMs`, summed as if the files ran one after another (task
 * 001-124). It limits what is selected, not how long the tier runs: a file
 * with no known duration counts 0, the first file is always taken, a file
 * can run slower than it last did, and a tier cut short by the run deadline
 * or a cancel gets a grace before it is forced (review wave 12b, S1).
 */
export const BACKLOG_TIER_BUDGET_MS = 300_000;

/**
 * Whether `revision` cancels a backlog tier in flight (D5 step 5 as
 * amended, task 001-124): its content re-key queued an edit's work in the
 * tier's lane (task 001-140), or it changes an input of the tier, whose
 * results the stability check would discard. An add or a delete cancels
 * through its runner part, which finds what it reaches (`queuesEdit`, task
 * 001-364: a build's hashed outputs that no test file reads cancelled a
 * 200-file tier). An edit no test file reaches lets the tier finish.
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
