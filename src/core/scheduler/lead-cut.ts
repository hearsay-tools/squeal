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
 *
 * Row 023-65 (dogfood round 8, W3's rest): with too few stored durations
 * the tier's work left cannot be estimated (every file with none counts 0),
 * so the time rule never cut, and the named file waited for a batch of 200
 * files on an empty store. Then the tier is cut when more than
 * `UNKNOWN_CUT_FILES` of its unfinished files are outside the leading batch.
 */

/**
 * Row 023-65: unfinished files outside the leading batch above which a tier
 * whose time is unknown is cut. 20 files are at least two rounds at the
 * widths a machine gives a batch (up to about 12 workers), so the named file
 * would wait at least one more round of files of unknown length, while a cut
 * runs again at most one round, the tier's in-progress files.
 */
export const UNKNOWN_CUT_FILES = 20;

/**
 * Durations of a stored floor: `known` of `files` are too few to estimate
 * their time from. The same floor as the call's estimate (row 023-62,
 * `tooFew` in `src/cli/status-at-estimate.ts`; a test holds them equal), so a
 * tier the call reads as "time unknown" is the one this rule cuts.
 */
export function tooFewStored(known: number, files: number): boolean {
  if (known >= files) return false;
  return known * 5 < files || (known < STORED_LEAST && known * 2 < files);
}

/** The call's `MEASURED_LEAST`: below this many durations, at most half the files may lack one. */
const STORED_LEAST = 10;

/** What `leadCut` reads of the yield check's state: the files an earlier yield cut. */
export type CutMarks = (entry: TierFile) => boolean;

/**
 * Whether `tier` yields to a leading batch it holds, at the reading of
 * `context.now()`: it can be cut (a cancel, not a slot, a turn, a slow or a
 * focused tier), it holds no file an earlier yield cut (`marked`: at most
 * one cut per leading batch, since the cut marks its files too), files of
 * the least-ranked leading batch run in it beside unfinished files of no
 * such batch, and the tier's work left (`workLeft`) exceeds those files'
 * own time by more than `margin`, `YIELD_REMAINDER_MS`. Review 0.1.607 P1:
 * their own time is their batch's wall time at the tier's width, the
 * longer of their longest file and their sum over the width, so a cut
 * saves more than the margin; by their longest file alone, a large leading
 * group could be cut for a saving under it, or for none. Row 023-65: a tier
 * whose stored durations are too few (`tooFewStored`) is cut instead when
 * more than `UNKNOWN_CUT_FILES` of its unfinished files are outside the
 * leading batch.
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
  const known = tier.files.filter(({ file }) => file.durationMs !== null).length;
  if (tooFewStored(known, tier.files.length)) return left.length - own.length > UNKNOWN_CUT_FILES;
  const ms = own.map(({ file }) => file.durationMs ?? 0);
  const ownMs = Math.max(0, ...ms, ms.reduce((a, m) => a + m, 0) / widthOf(tier));
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
  const width = widthOf(tier);
  const sum = (files: readonly TierFile[]) => files.reduce((total, f) => total + ms(f), 0);
  const left = unfinished(tier);
  const longest = Math.max(0, ...left.map(ms));
  const ran = elapsed(context, tier);
  const whole = Math.max(longest, sum(tier.files) / width) - ran;
  return Math.max(longest - ran, Math.min(whole, sum(left) / width));
}

/** The files of `tier` that run at once: its grant, else one per file. */
const widthOf = (tier: Tier) =>
  Math.max(1, Math.min(tier.files.length, tier.lease?.grant ?? tier.files.length));

/** How long `tier` has run, its start moved by the calendar steps since (row 011-377). */
function elapsed(context: SchedulerContext, tier: Tier): number {
  const { startedAt } = tier;
  if (startedAt === undefined) return 0;
  const start = context.steps?.since(startedAt as EpochMs, tier.startedStep ?? 0) ?? startedAt;
  return context.now() - start;
}
