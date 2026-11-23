import type { EpochMs } from "../types/common.js";
import type { SchedulerContext } from "./context.js";
import type { Ledger } from "./ledger.js";
import type { Tier, TierFile } from "./tiers.js";
import { unfinished } from "./yield-waits.js";

/*
 * Row 023-60 (spec 023 D7.3, dogfood round 7 W3; spec 011 C4 step 5, the
 * coordinator approved, request 5659a672): a file a call names leads the
 * queue (row 023-34, a leading batch ranks below 0), but a file already
 * running inside a wider tier stays there, and its result lands only when
 * the tier ends: in round 7, 250 to 420 s for a file of 3 s. Only Vitest
 * reports each file's end, and results land from the run's report alone,
 * so the tier is cut instead: its ended files keep their results, its
 * other files go back to their batch, and the leading files run next,
 * alone. A cut runs again at most the tier's in-progress files, its grant.
 */

/** What `leadCut` reads of the yield check's state: the files an earlier yield cut. */
export type CutMarks = (entry: TierFile) => boolean;

/**
 * Whether `tier` yields to a leading batch it holds, at the reading of
 * `context.now()`: it can be cut (a cancel, not a slot, a turn, a slow or a
 * focused tier), it holds no file an earlier yield cut (`marked`: at most
 * one cut per leading batch, since the cut marks its files too), files of
 * the least-ranked leading batch run in it beside unfinished files of no
 * such batch, and the tier's work left (`workLeft`) exceeds those files'
 * own time by more than `margin`, `YIELD_REMAINDER_MS`.
 */
export function leadCut(
  context: SchedulerContext,
  ledger: Ledger,
  tier: Tier,
  marked: CutMarks,
  margin: number,
): boolean {
  if (tier.cancel === null || tier.slot === true) return false;
  if (tier.kind === "turn" || tier.kind === "slow" || tier.kind === "focused") return false;
  const left = unfinished(tier);
  if (left.some(marked)) return false;
  const at = context.now();
  const rankOf = (entry: TierFile) => ledger.queue.rankAt(entry.file.ref, at)?.rank ?? null;
  let lead = 0;
  for (const entry of tier.files) {
    const rank = rankOf(entry);
    if (rank !== null && rank < lead) lead = rank;
  }
  if (lead === 0) return false;
  const own = left.filter((entry) => rankOf(entry) === lead);
  if (own.length === left.length) return false;
  const ownMs = Math.max(0, ...own.map(({ file }) => file.durationMs ?? 0));
  return workLeft(context, tier) - ownMs > margin;
}

/**
 * The tier's estimated wall time left: its files run `width` at once (its
 * grant, else one per file), so the whole tier takes the longer of its
 * longest file and its summed durations over the width; less the time it
 * has run, and never more than its unfinished files' sum over the width,
 * nor less than its longest unfinished file's time left. A file with no
 * known duration counts 0, as `remainder` counts it.
 */
export function workLeft(context: SchedulerContext, tier: Tier): number {
  const ms = ({ file }: TierFile) => file.durationMs ?? 0;
  const width = Math.max(1, Math.min(tier.files.length, tier.lease?.grant ?? tier.files.length));
  const sum = (files: readonly TierFile[]) => files.reduce((total, f) => total + ms(f), 0);
  const left = unfinished(tier);
  const longest = Math.max(0, ...left.map(ms));
  const ran = elapsed(context, tier);
  const whole = Math.max(longest, sum(tier.files) / width) - ran;
  return Math.max(longest - ran, Math.min(whole, sum(left) / width));
}

/** How long `tier` has run, its start moved by the calendar steps since (row 011-377). */
function elapsed(context: SchedulerContext, tier: Tier): number {
  const { startedAt } = tier;
  if (startedAt === undefined) return 0;
  const start = context.steps?.since(startedAt as EpochMs, tier.startedStep ?? 0) ?? startedAt;
  return context.now() - start;
}
