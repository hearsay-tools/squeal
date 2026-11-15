import { isBusy, withBusySliceSync } from "../store/connection.js";
import type { EpochMs, WorktreeId } from "../types/common.js";
import type { Revision } from "../types/revision.js";
import type { TierYield } from "../types/standing.js";
import { type Store, worktreeMetaKey } from "../types/store.js";
import type { SchedulerContext } from "./context.js";
import { type Cut, decideYields, holds, YIELD_REMAINDER_MS } from "./decide-yields.js";
import type { FileState } from "./files.js";
import type { Ledger } from "./ledger.js";
import type { CutFiles } from "./sharing.js";
import type { SchedulerEvent } from "./step-events.js";
import type { Tier } from "./tiers.js";
import type { WakeSlot, Wakes } from "./wakes.js";
import { YieldHistory } from "./yield-history.js";
import { readYieldRow, type YieldRow, yieldRowText } from "./yield-row.js";

export { YIELD_REMAINDER_MS };

/**
 * Spec 011 C4 step 5 as amended 2026-10-21 (row 011-51): which fast tiers in
 * flight a revision, a runner part or a promotion cancels, the files a yield
 * cut, and what each tier in flight does for a promoted file's wait,
 * published for status in one `yields` meta row of the worktree (C15).
 * Tier selection reads the files cut past their estimate (`CutFiles`, row
 * 011-112).
 */
export class TierYields implements CutFiles {
  /**
   * The key a yield cut each file at, its `resultsApplied` then and whether
   * its tier was past its estimate, by `testFileId`, until a result lands at
   * that key after the cut or its key moves. A forced file already has a result at its key when it is cut, so
   * `resultKey` alone would end the mark at once (review `reviews/0.1.237.md`).
   */
  #cut: ReadonlyMap<string, Cut> = new Map();
  /** What each tier in flight does for a wait in its lane, by run id, as last published. */
  #standing = new Map<string, TierYield>();
  /**
   * When each tier in flight that a wait waits for yields at the latest,
   * `YIELD_REMAINDER_MS` past its estimate (row 011-107), or is checked
   * again while its promoted files wait on claims or stored results (row
   * 011-123) or when the promotion that ranks its files ends (row 011-184),
   * by run id.
   */
  readonly #bounds = new Map<string, EpochMs>();
  /** The wake that checks the tiers again at the earliest of `#bounds` (row 011-352). */
  #wake: WakeSlot | null = null;
  /** What status reads beside the standings: the last yield, the lanes, the ended counts (row 011-209). */
  readonly #history = new YieldHistory();

  /**
   * `recheck` checks the tiers in flight again under the scheduler's lock,
   * as an event does: a tier reaches its bound with no event (row 011-107),
   * or a claim may have ended with none (row 011-123); it takes stored
   * results first.
   */
  constructor(
    private readonly recheck: () => void,
    /** The scheduler's wake loop (row 011-352). */
    private readonly wakes: Wakes,
  ) {}

  /**
   * Cancels each of `tiers` that C4 step 5 cancels after `revision`, the
   * revision just stored (`null`: a runner part applied, a promotion came or
   * a file ended):
   * - any, when the revisions during its run changed an input of every file
   *   of it that has not ended, whose results the stability check would
   *   discard;
   * - a backlog tier, as `cancelsBacklog` says;
   * - any but the backlog's turn yields, once per file and key, while an
   *   edit's work that came during its run or a promoted file is queued in
   *   its lane, one that waits on another worktree's claim of its key or
   *   has a result stored there aside (rows 011-55, 011-123), or `revision`
   *   makes the lane's runner part wait for the run, when its estimated
   *   remainder exceeds `YIELD_REMAINDER_MS` or, as `overruns` allows, it
   *   has run that long past its estimate (row 011-107); one that does not
   *   yet is checked again at that bound, and one only such promoted files
   *   wait for every `CLAIM_RECHECK_MS` (row 011-123): a claim ends with no
   *   event when its claimant's heartbeat is lost or the waiter's bound
   *   passes (C7). Once it has run `YIELD_REMAINDER_MS`, a promoted file
   *   counts only when it ranks before each of its files that has not
   *   ended (`rankToBeat`, row 011-184; a tier of promoted files only, from
   *   its start); before, only when the cut starts it before the tier's
   *   remainder (`startsSooner`, row 011-263); a tier
   *   only other promoted files wait for then runs on, checked again when a
   *   file of it ends (`standsNamed`, review `reviews/0.1.296.md` B1; a
   *   batch's rank does not lapse, row 011-268).
   * A file has ended when the runner named it (`Tier.ended`, row 011-54,
   * review `reviews/0.1.237.md` B2); a runner that names none leaves every
   * file unfinished, so its tier is cancelled by the first rule only when
   * every file of it was re-keyed. A backlog tier cancelled by either of the
   * first two rules starts its lane's wait for quiet (`BacklogQuiet`, row
   * 011-82); a backlog slot, whose runner cannot cancel, starts none. A
   * backlog tier of promoted files only (`Tier.promoted`, row 011-265),
   * while a file of it that has not ended has an open promotion
   * (`selected`), is cancelled by the first rule only, and an edit's work
   * does not make it yield, since its cut files would go back promoted and
   * run before the edit's work: a promoted file or a focused entry still
   * does, and with nothing else waiting it stands `named`. Once none is
   * open, it is a backlog tier as any (review `reviews/0.1.377.md` B1).
   *
   * One reading of the clock decides every tier (row 011-194, review
   * `reviews/0.1.296-r2.md` B2): `decideYields` reads only `at`, so a
   * deadline or a bound the clock passes during the check is still the one
   * the decision stood on. Row 011-354: `decideYields` decides; this
   * applies its answer: the claim and focused bookkeeping its reads would
   * have written (review 0.1.514 B1), then tier by tier in its order.
   * Nothing while `held` (row 011-72). `at` is the one reading, the step's
   * (row 011-366), else the clock's now: the published row is stamped with
   * it too, and only the timer reads its own.
   */
  check(
    context: SchedulerContext,
    ledger: Ledger,
    tiers: readonly Tier[],
    revision: Revision | null,
    held: boolean,
    at: EpochMs = context.now(),
  ): void {
    const view = { context, ledger, tiers, marks: this.#cut, standing: this.#standing, held };
    const decided = decideYields(at, revision, view);
    if (decided === null) return;
    // Review 0.1.514 B1, row 011-361: what the decision's reads record, in order, as they read it.
    for (const note of decided.bookkeeping) {
      if (note.kind === "claim") ledger.claims.record(note.key, note.claimed, at);
      else ledger.queue.focused.waiting(at);
    }
    this.#cut = new Map(decided.marks);
    this.#standing = new Map(decided.standing);
    for (const { tier, decision, bound, yielded } of decided.tiers) {
      if (yielded !== null) {
        const { to, remainderMs, cut } = yielded;
        this.#history.yielded(at, tier, to, remainderMs, cut, YIELD_REMAINDER_MS);
      }
      if (typeof decision === "string") {
        if (decision !== "yield" && tier.kind === "backlog" && tier.slot !== true)
          context.quiet?.cancelled(tier.lane, at);
        tier.cancel?.abort(decision);
      }
      if (bound === null) this.#bounds.delete(tier.runId);
      else this.#bounds.set(tier.runId, bound);
    }
    if (decided.changed) this.#publish(context, at);
    this.#arm(context);
  }

  /**
   * `tier` runs on for a promoted file that ranks with or after its files
   * (`named`): a file of it that ends may raise the rank to beat, so the
   * tiers are checked again (review `reviews/0.1.296.md` B1).
   */
  standsNamed(tier: Tier): boolean {
    return this.#standing.get(tier.runId)?.kind === "named";
  }

  cutPastEstimate(file: FileState): boolean {
    const cut = this.#cut.get(file.id);
    return cut?.past === true && holds(file, cut);
  }

  /**
   * The runner named a file of `tier` ended (row 011-209, F4): the row gets
   * the tier's ended count, written at most once per `ENDED_WRITE_MS`. A
   * file end inside that window writes nothing; the next write of the row
   * carries the newest count, with no timer and no trailing write. The
   * runner's callback calls this outside the scheduler's lock and past any
   * busy slice, so the write waits for no lock: a busy store skips it, and
   * the daemon's event loop is never held for it (`busy-tier.test.ts`).
   */
  fileEnded(context: SchedulerContext, tier: Tier): void {
    if (!this.#history.fileEnded(context.now(), tier)) return;
    try {
      withBusySliceSync(0, () => this.#publish(context));
    } catch (error) {
      if (!isBusy(error)) throw error;
    }
  }

  /**
   * `tier` is no longer in flight: its standing and its bound go, and the
   * history notes its end (`YieldHistory.ended`, row 011-209).
   */
  ended(context: SchedulerContext, tier: Tier): void {
    let changed = this.#standing.delete(tier.runId);
    changed = this.#history.ended(context.now(), tier) || changed;
    if (changed) this.#publish(context);
    if (this.#bounds.delete(tier.runId)) this.#arm(context);
  }

  /** The scheduler closed: no check comes again. */
  close(): void {
    this.#bounds.clear();
    this.#disarm();
  }

  /**
   * States the wake at the earliest bound, none without a bound. `_context`
   * chose the fallback loop's clock until row 011-364; dropping it touches
   * `check`'s body (row 011-361's), so it goes after that row lands.
   */
  #arm(_context: SchedulerContext): void {
    this.#wake ??= this.wakes.slot("yield-bound", () => this.recheck());
    if (this.#bounds.size === 0) this.#wake.clear();
    else this.#wake.at(Math.min(...this.#bounds.values()) as EpochMs);
  }

  #disarm(): void {
    this.#wake?.clear();
  }

  /** Writes the yield row, stamped `at`: a check's reading, else now. */
  #publish(context: SchedulerContext, at: EpochMs = context.now()): void {
    const { store, worktreeId } = context;
    writeYieldRow(store, worktreeId, at, this.#history.row(this.#standing));
  }
}

/**
 * How an event reaches the yield check (row 011-354): `none`; `check`, in
 * the event's own lock turn, after `trigger`; or `adopt-then-check`, a check
 * queued under the lock that first takes the results other worktrees stored
 * (row 011-123), so a claimant's record cuts nothing.
 */
export type YieldReach =
  | { readonly reach: "none" }
  | { readonly reach: "check"; readonly trigger: Revision | null }
  | { readonly reach: "adopt-then-check" };

/** What `yieldReach` reads of the tiers in flight. */
export interface ReachView {
  /** The tier in flight `runId`, or `undefined`. */
  tier(runId: string): Tier | undefined;
  /** `TierYields.standsNamed`. */
  standsNamed(tier: Tier): boolean;
}

const NONE: YieldReach = { reach: "none" };
const CHECK: YieldReach = { reach: "check", trigger: null };
const ADOPT: YieldReach = { reach: "adopt-then-check" };

/**
 * Which events reach the yield check, and how (row 011-354, C4 step 5): the
 * one place, so the call sites pass their event and filter nothing.
 * - A stored revision, applied runner work, a request taken (rows 011-51,
 *   011-145): a check in their lock turn.
 * - A tier started beside the batch's tier: that tier no longer stands for
 *   the work that went beside it (row 011-269). Any other start: none.
 * - A file end, only when a revision changed an input of its tier (every
 *   file left may now be re-keyed, row 011-54) or the tier stands `named`
 *   (the ended file may have ranked first, review `reviews/0.1.296.md` B1,
 *   R398); queued, adopting first.
 * - The yield bound's wake: a tier past its estimate (row 011-107) or one
 *   only promoted files held by claims or with stored results wait for
 *   (row 011-123); queued, adopting first.
 * - Every other event: none. The claims wake ends the pump's wait only.
 * A hold reaches nothing: the check reads it in its own lock turn
 * (`YieldView.held`), so a queued check reads it when it runs.
 */
export function yieldReach(event: SchedulerEvent, view: ReachView): YieldReach {
  switch (event.kind) {
    case "revision":
      return { reach: "check", trigger: event.revision };
    case "runner-work-applied":
    case "request-taken":
      return CHECK;
    case "tier-started":
      return event.beside ? CHECK : NONE;
    case "file-ended": {
      const tier = view.tier(event.runId);
      if (tier === undefined) return NONE;
      return tier.changes.size > 0 || view.standsNamed(tier) ? ADOPT : NONE;
    }
    case "wake":
      return event.reason === "yield-bound" ? ADOPT : NONE;
    case "asked":
    case "slot-ran":
    case "tier-ended":
    case "runner-work-drained":
    case "stalled":
    case "closing":
    case "pump-ended":
    case "hold-began":
    case "slow-ended":
    case "beside-ended":
    case "install-missing":
      return NONE;
    default: {
      const unknown: never = event;
      throw new Error(
        `squeal scheduler: an event the yield check does not place: ${String(unknown)}`,
      );
    }
  }
}

/** `meta` key of `worktreeId`'s tiers in flight and whether each yields: `{ at, tiers }` (row 011-209: and more). */
export function yieldsMetaKey(worktreeId: WorktreeId): string {
  return worktreeMetaKey("yields", worktreeId);
}

/** Writes `row` as of `at` in `worktreeId`'s `yields` row, or deletes the row when it says nothing. */
export function writeYieldRow(
  store: Store,
  worktreeId: WorktreeId,
  at: EpochMs,
  row: YieldRow,
): void {
  const text = yieldRowText(at, row);
  if (text === null) store.meta.delete(yieldsMetaKey(worktreeId));
  else store.meta.set(yieldsMetaKey(worktreeId), text);
}

/** What the daemon started at `daemonStartedAt` published in `worktreeId`'s `yields` row (`readYieldRow`). */
export function publishedYieldRow(
  store: Store,
  worktreeId: WorktreeId,
  daemonStartedAt: EpochMs,
): YieldRow {
  return readYieldRow(store.meta.get(yieldsMetaKey(worktreeId)), daemonStartedAt);
}
