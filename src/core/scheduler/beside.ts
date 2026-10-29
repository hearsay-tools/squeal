import type { TestFileRef } from "../types/index.js";
import type { SchedulerContext } from "./context.js";
import type { Ledger } from "./ledger.js";
import { cancels, laneOf, type Tier } from "./tiers.js";

/**
 * A later wait's batch of at most this many file-seconds of last-known time
 * starts beside a batch's tier, as an edit's tier does (spec 011 C4 step 5
 * as amended 2026-10-29, row 011-269, `research/named-wait-batches.md`
 * Recommendation 3: behind a 55-file batch, a one-file wait of a 2 s file
 * got its result in 3 s beside, against 38 to 338 s in strict order). A
 * probe's choice, not a measured optimum.
 */
export const BESIDE_BATCH_MS = 30_000;

/**
 * The files a tier beside a running batch's tier takes, or `null` when none
 * is due (row 011-269, Recommendation 2 and 3). In a lane whose runner
 * cancels a run (Vitest) and runs a batch's tier (`Tier.promoted`) with no
 * tier beside it yet: work an edit caused, a file of a batch included, which
 * keeps its batch for rank and status (coordinator, request e3edd85b); and
 * each later batch whose queued files there hold at most `BESIDE_BATCH_MS`
 * of last-known time, none unknown. Such a tier is an edit's:
 * `runner.tierSize` files that share by duration, no permit (C10), in the
 * lane's second instance (`BESIDE_LANE_PREFIX`), so it takes at most
 * `runner.tierSize` workers above the batch's grant. It does not cancel the
 * batch's tier: an edited file of it runs beside at its new key, and the
 * batch's run of it at the old key is superseded (`supersededIn`).
 */
export function besideFiles(
  context: SchedulerContext,
  ledger: Ledger,
  inFlight: readonly Tier[],
): ((ref: TestFileRef) => boolean) | null {
  const { queue } = ledger;
  const at = context.now();
  const rankOf = (ref: TestFileRef) => queue.rankAt(ref, at)?.rank ?? null;
  const lanes = new Set<string>();
  /** The batches a running tier holds: their queued files wait for the batch's next tier. */
  const running = new Set<number | null>();
  for (const tier of inFlight) {
    const first = tier.files[0]?.file.ref;
    if (tier.promoted !== true || first === undefined || !cancels(context, first)) continue;
    lanes.add(tier.lane);
    for (const { file } of tier.files) running.add(rankOf(file.ref));
  }
  for (const tier of inFlight) if (tier.beside === true) lanes.delete(tier.lane);
  if (lanes.size === 0) return null;
  const inLanes = (ref: TestFileRef) => lanes.has(laneOf(context, ref));
  const sums = new Map<number, number>();
  for (const ref of ledger.orderedBatches()) {
    const rank = rankOf(ref);
    if (rank === null || running.has(rank) || !inLanes(ref)) continue;
    const ms = ledger.file(ref)?.durationMs ?? Number.POSITIVE_INFINITY;
    sums.set(rank, (sums.get(rank) ?? 0) + ms);
  }
  const small = new Set([...sums].filter(([, ms]) => ms <= BESIDE_BATCH_MS).map(([rank]) => rank));
  const takes = (ref: TestFileRef) => {
    if (!inLanes(ref)) return false;
    const rank = rankOf(ref);
    return queue.isRecent(ref) || (rank !== null && small.has(rank));
  };
  return queue.hasFast(takes) ? takes : null;
}

/**
 * Whether `lane` has no batch left for its second instance (row 011-269): no
 * batch's tier and no tier beside one in flight there, and no file of a
 * batch queued in it. The scheduler then closes that instance.
 */
export function besideDone(
  context: SchedulerContext,
  ledger: Ledger,
  inFlight: readonly Tier[],
  lane: string,
): boolean {
  const busy = inFlight.some(
    (tier) => tier.lane === lane && (tier.promoted === true || tier.beside === true),
  );
  if (busy) return false;
  return !ledger.queue.hasFast(
    (ref) => ledger.queue.isPromoted(ref) && laneOf(context, ref) === lane,
  );
}
