import type { Revision } from "../types/index.js";
import type { Ledger } from "./ledger.js";
import type { Tier } from "./tiers.js";

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
 * Whether `revision` cancels the backlog tier in flight (D5 step 5 as
 * amended, task 001-124): its content re-key queued an edit's work, it adds
 * or deletes a path, whose importers only the runner part finds after the
 * tier, or it changes an input of the tier, whose results the stability
 * check would discard. An edit no test file reaches lets the tier finish.
 */
export function cancelsBacklog(ledger: Ledger, revision: Revision, tier: Tier): boolean {
  if (ledger.queue.hasRecent()) return true;
  const inputs = new Set(tier.files.flatMap((f) => f.inputs));
  return revision.changes.some(
    (change) => change.oldHash === null || change.newHash === null || inputs.has(change.path),
  );
}

/** `BACKLOG_TIER_BUDGET_MS`, or half of `runner.timeoutMs` when that is less. */
export function backlogBudget(timeoutMs: number | null): number {
  return timeoutMs === null
    ? BACKLOG_TIER_BUDGET_MS
    : Math.min(BACKLOG_TIER_BUDGET_MS, timeoutMs / 2);
}
