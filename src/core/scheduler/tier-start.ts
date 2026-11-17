import type { PoolLease } from "../capacity/pool.js";
import type { EpochMs } from "../types/common.js";
import { CAPACITY_RECHECK_MS, WAIT_FOR_CAPACITY, widthLease } from "./capacity.js";
import type { SchedulerContext } from "./context.js";
import { recordEditTier } from "./edit-timings.js";
import { startFocusedTier } from "./focused.js";
import type { Ledger } from "./ledger.js";
import { type Candidate, type Idle, isIdle, type TierPlan } from "./tier-plan.js";
import { estimateMs } from "./tier-width.js";
import { startTier, type Tier, type TierFile } from "./tiers.js";

/** What the caller of `startNext` adds around each start. */
export interface StartOptions {
  /** Called before each start with its lane: the admission's lock turn (`checkTurn`, row 011-340). */
  readonly check?: (lane: string) => void;
  /**
   * Flies each tier as it starts, before the plan goes on: with it, a lane
   * of slots fills every free slot in one turn (task 011-21 slice 2).
   * Without it, `startNext` returns at the first start. After it, an edit
   * tier's timings are recorded (`recordEditTier`, row 005-96); without it,
   * none are: the caller owns that tier's flight.
   */
  readonly fly?: (tier: Tier) => void;
  /** The step's one reading (row 011-372): the started tier's count toward a batch or the turn reads it. */
  readonly at?: EpochMs;
}

/** What starting one candidate did. */
type Act =
  | { readonly tier: Tier; readonly grant: number }
  | { readonly refused: "pool" | "narrower" }
  | { readonly unstarted: readonly TierFile[] };

/**
 * The act step of the tier plan (row 011-346, `research/tier-plan.md`):
 * starts the plan's first candidate the pool grants. A grant ask takes its
 * grant, keeps the files that fit it (`atGrant`), and gives back a grant
 * narrower than an edit's tier of a batch's files; a refusal takes the
 * plan's next candidate, and a start that a lookup settled meanwhile plans
 * again (`afterUnstarted`). Every lease is released until its tier owns it.
 * The started tier counts toward a batch or the turn (`batchStarted`,
 * `RunQueue.tierSelected`). Returns the first tier started, or why none did:
 * the plan's idle answer, `pool` when the pool refused a candidate and
 * neither a claim nor a wait for quiet came first.
 */
export function startNext(
  context: SchedulerContext,
  ledger: Ledger,
  plan: TierPlan,
  options: StartOptions = {},
): { readonly tier: Tier } | { readonly idle: Idle } {
  let step: Candidate | Idle | null = plan.first;
  let first: Tier | null = null;
  let refused = false;
  for (;;) {
    if (step === null || isIdle(step)) {
      if (first !== null) return { tier: first };
      if (step === null) throw new Error("squeal scheduler: a tier plan ended without an answer");
      if (!refused || waitsFirst(step)) return { idle: step };
      return {
        idle: { idle: "pool", at: step.at, wakeAt: (step.at + CAPACITY_RECHECK_MS) as EpochMs },
      };
    }
    options.check?.(step.lane);
    const done = act(context, ledger, step, options.at);
    if ("tier" in done) {
      first ??= done.tier;
      if (options.fly === undefined) return { tier: first };
      options.fly(done.tier);
      // Row 005-96: once its flight owns the launch, a write that fails loses only the sample
      // (review 0.1.535 B1).
      recordEditTier(context, done.tier, done.grant);
      step = plan.afterStart(done.tier);
    } else if ("refused" in done) {
      refused ||= done.refused === "pool";
      step = plan.afterRefusal(done.refused);
    } else step = plan.afterUnstarted(done.unstarted);
  }
}

/** A claim or a wait for quiet comes before the pool in the pump's order. */
function waitsFirst(idle: Idle): boolean {
  return idle.idle === "claims" || idle.idle === "quiet";
}

/** Starts `candidate`, or says why it did not start; its count reads `at` (row 011-372). */
function act(
  context: SchedulerContext,
  ledger: Ledger,
  candidate: Candidate,
  at: EpochMs | undefined,
): Act {
  if (candidate.focus !== null) {
    const tier = startFocusedTier(context, ledger, candidate.focus, candidate.files, at);
    return tier === null ? { unstarted: [] } : { tier, grant: tier.files.length };
  }
  const ask = candidate.width;
  // Row 011-309: a refusal holds the lane's files, unless the batch's tier goes on as an edit's;
  // a grant ends the lane's wait either way (review 0.1.413 B2).
  const taken =
    ask === null
      ? null
      : context.capacity?.take(ask.want, "fast", ask.least, ask.kind, ask.lane, ask.refusalWaits);
  if (taken === WAIT_FOR_CAPACITY) return { refused: "pool" };
  const lease = taken ? widthLease(taken, ask?.want ?? 0) : taken;
  let files = candidate.files;
  let tier: Tier | null = null;
  try {
    if (lease && ask !== null) {
      const fits = ask.atGrant(lease.grant);
      // Row 011-308: a batch's tier granted less than an edit's tier of its files goes as an edit's.
      if (fits.narrower) return { refused: "narrower" };
      files = fits.files;
    }
    tier =
      files.length === 0
        ? null
        : startTier(context, ledger, files, candidate.kind, lease ?? undefined, {
            promoted: candidate.promoted,
            beside: candidate.beside,
            at,
          });
  } finally {
    // The tier owns the lease once it starts; until then it is returned here (review 001-384, B2).
    if (tier === null) lease?.release();
  }
  if (tier === null) return { unstarted: files };
  // A batch's tier does not count toward the backlog's turn; the rest gets the next (row 011-268).
  // A tier beside it counts toward neither (row 011-269).
  const grant = grantOf(lease, ask, tier);
  if (candidate.counts === "batch") batchStarted(context, ledger, tier, grant, at);
  else if (candidate.counts === "tier") ledger.queue.tierSelected(candidate.tookBacklog, at);
  return { tier, grant };
}

/**
 * The workers `tier` started with: its lease's grant. An edit's tier of the
 * batch runs as wide as its files, under the runner's own width.
 */
function grantOf(lease: PoolLease | null | undefined, ask: Candidate["width"], tier: Tier): number {
  return lease?.grant ?? (ask === null ? tier.files.length : ask.offer);
}

/**
 * A batch's `tier` started at `grant` workers (row 011-268): the queue gives
 * the files in no batch the next tier, and the batch's estimated end, its
 * files' wall estimate at the tier's width from its start, goes to status.
 * Its batch ranks read `at`, the step's reading (row 011-372).
 */
function batchStarted(
  context: SchedulerContext,
  ledger: Ledger,
  tier: Tier,
  grant: number,
  at: EpochMs | undefined,
): void {
  const first = tier.files[0]?.file.ref;
  if (first === undefined) return;
  const estimate = estimateMs(context.runner.traits, tier.files, grant);
  ledger.queue.batchSelected(at);
  const end = ((tier.startedAt ?? context.now()) + estimate) as EpochMs;
  ledger.queue.batchStarted(first, end, at);
}
