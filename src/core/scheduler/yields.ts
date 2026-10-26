import { isBusy, withBusySliceSync } from "../store/index.js";
import {
  type CancelCause,
  type CheckKey,
  type EpochMs,
  type LastYield,
  type Revision,
  type Store,
  type TestFileRef,
  type TierYield,
  type WorktreeId,
  worktreeMetaKey,
} from "../types/index.js";
import { cancelsBacklog } from "./backlog.js";
import { CLAIM_RECHECK_MS, peekClaim } from "./claims.js";
import type { SchedulerContext } from "./context.js";
import type { FileState } from "./files.js";
import { focusedWaiting } from "./focused.js";
import type { Ledger } from "./ledger.js";
import type { CutFiles } from "./sharing.js";
import { laneOf, type Tier, type TierFile } from "./tiers.js";
import { YieldHistory } from "./yield-history.js";
import { readYieldRow, type YieldRow, yieldRowText } from "./yield-row.js";

export { ENDED_WRITE_MS } from "./yield-history.js";

/**
 * A running tier yields only when its estimated remainder exceeds this (spec
 * 011 C4 step 5 as amended 2026-10-21; the human chose rule B at 30 s, row
 * 001-381, `research/running-tier-yields.md`: on cezar's 6.5 days, 82% of
 * the time edits waited for a tier and 52% of named waits' went, for 4,454
 * file-seconds run again), or once it has run this long past its estimate
 * (row 011-107, gh-73: a stale, short estimate never yielded; `overruns`).
 */
export const YIELD_REMAINDER_MS = 30_000;

/**
 * A tier only promoted files wait for, each held by another worktree's
 * claim of its key or with a result stored there to take: it runs on, and
 * is checked again every `CLAIM_RECHECK_MS`, which takes the stored results
 * first (row 011-123). Status reads nothing of it: a held file's wait names
 * the claim.
 */
const RECHECK = { kind: "recheck" } as const;

/**
 * What C4 step 5 does with a tier in flight now: cancel it for one of the
 * causes it names (row 011-56), a yield among them, or what it says.
 */
type Decision =
  | Extract<CancelCause, "supersession" | "backlog" | "yield">
  | TierYield
  | typeof RECHECK
  | null;

/**
 * What waits for a tier in its lane (`waitedFor`): work a yield runs sooner,
 * as a yield names it (`LastYield.to`, row 011-209), or only promoted files
 * a yield runs nothing sooner for, until a claim ends or a stored result is
 * taken, or only promoted files that a file of the tier ranks with or
 * before once it has run 30 s (`named`, row 011-184).
 */
type Waiting = LastYield["to"] | "recheck" | "named" | null;

/**
 * The rank a promoted file must be below to make a tier yield (`rankToBeat`);
 * `until` is the deadline of the promotion that gives the rank, when it rises
 * with no event, `null` when none does (row 011-184).
 */
interface Beat {
  readonly rank: number;
  readonly until: number | null;
}

/**
 * A yield cut a file at `key` when it had `applied` results
 * (`FileState.resultsApplied`); `past` when its tier had run past its
 * estimate (`overruns`, row 011-107).
 */
interface Cut {
  readonly key: CheckKey;
  readonly applied: number;
  readonly past: boolean;
}

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
  readonly #cut = new Map<string, Cut>();
  /** What each tier in flight does for a wait in its lane, by run id, as last published. */
  readonly #standing = new Map<string, TierYield>();
  /**
   * When each tier in flight that a wait waits for yields at the latest,
   * `YIELD_REMAINDER_MS` past its estimate (row 011-107), or is checked
   * again while its promoted files wait on claims or stored results (row
   * 011-123) or when the promotion that ranks its files ends (row 011-184),
   * by run id.
   */
  readonly #bounds = new Map<string, EpochMs>();
  /** The one timer that checks the tiers again at the earliest of `#bounds`. */
  #timer: ReturnType<typeof setTimeout> | null = null;
  /** What status reads beside the standings: the last yield, the lanes, the ended counts (row 011-209). */
  readonly #history = new YieldHistory();

  /**
   * `recheck` checks the tiers in flight again under the scheduler's lock,
   * as an event does: a tier reaches its bound with no event (row 011-107),
   * or a claim may have ended with none (row 011-123); it takes stored
   * results first.
   */
  constructor(private readonly recheck: () => void = () => {}) {}

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
   *   ended (`rankToBeat`, row 011-184); a tier only other promoted files
   *   wait for then runs on, checked again when a file of it ends
   *   (`standsNamed`) or the promotion that gives the rank to beat passes
   *   its deadline, at once when it passed during the check (reviews
   *   `reviews/0.1.296.md` B1 and B2, `reviews/0.1.296-r2.md` B2).
   * A file has ended when the runner named it (`Tier.ended`, row 011-54,
   * review `reviews/0.1.237.md` B2); a runner that names none leaves every
   * file unfinished, so its tier is cancelled by the first rule only when
   * every file of it was re-keyed. A backlog tier cancelled by either of the
   * first two rules starts its lane's wait for quiet (`BacklogQuiet`, row
   * 011-82); a backlog slot, whose runner cannot cancel, starts none.
   *
   * One reading of the clock decides every tier (row 011-194, review
   * `reviews/0.1.296-r2.md` B2): the decision reads `now` of a context that
   * returns it, so a deadline or a bound the clock passes during the check
   * is still the one the decision stood on. The timer and the published row
   * read their own.
   */
  check(
    context: SchedulerContext,
    ledger: Ledger,
    tiers: readonly Tier[],
    revision: Revision | null,
  ): void {
    this.#forget(ledger);
    const at = context.now();
    const reading: SchedulerContext = { ...context, now: () => at };
    let changed = false;
    for (const tier of tiers) {
      const beat = rankToBeat(reading, ledger, tier);
      const decision = this.#decide(reading, ledger, tier, revision, beat);
      if (typeof decision === "string") {
        if (decision === "yield") {
          const left = remainder(reading, tier);
          const cut = unfinished(tier);
          for (const { file, key } of cut)
            this.#cut.set(file.id, { key, applied: file.resultsApplied, past: left < 0 });
          // Row 011-209: what the yield ran sooner, as `#decide` read it.
          const to = waitedFor(reading, ledger, tier, revision, beat);
          if (to === "edit" || to === "promoted" || to === "runner") {
            this.#history.yielded(at, tier, to, left, cut, YIELD_REMAINDER_MS);
            changed = true;
          }
        } else if (tier.kind === "backlog" && tier.slot !== true)
          context.quiet?.cancelled(tier.lane, at);
        tier.cancel?.abort(decision);
      }
      const standing =
        typeof decision === "string"
          ? { kind: "yields" as const }
          : decision?.kind === "recheck"
            ? null
            : decision;
      changed = this.#set(tier.runId, standing) || changed;
      const bound = typeof decision === "string" ? null : boundOf(reading, tier, decision, beat);
      if (bound === null) this.#bounds.delete(tier.runId);
      else this.#bounds.set(tier.runId, bound);
    }
    if (changed) this.#publish(context);
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

  #decide(
    context: SchedulerContext,
    ledger: Ledger,
    tier: Tier,
    revision: Revision | null,
    beat: Beat,
  ): Decision {
    const { cancel } = tier;
    if (tier.kind === "slow") return null;
    if (cancel?.signal.aborted === true) return { kind: "yields" };
    if (cancel !== null && superseded(tier)) return "supersession";
    // Row 011-145: a focused tier leads its lane, so it yields to nothing.
    if (tier.kind === "focused") return null;
    if (tier.kind === "backlog" && cancel !== null) {
      if (cancelsBacklog(context, ledger, revision, tier)) return "backlog";
    }
    const waiting = waitedFor(context, ledger, tier, revision, beat);
    if (waiting === null) return null;
    if (cancel === null || tier.slot === true)
      return waiting === "recheck" ? null : { kind: "runner" };
    if (waiting === "recheck") return RECHECK;
    if (tier.kind === "turn") return { kind: "turn" };
    if (unfinished(tier).some(({ file, key }) => this.#cut.get(file.id)?.key === key))
      return { kind: "cut" };
    if (waiting === "named") return { kind: "named" };
    return byRemainder(context, tier);
  }

  /** Sets the one timer at the earliest bound, none without a bound; unref'd, it never holds the process. */
  #arm(context: SchedulerContext): void {
    this.#disarm();
    if (this.#bounds.size === 0) return;
    const ms = Math.max(0, Math.min(...this.#bounds.values()) - context.now());
    this.#timer = setTimeout(() => {
      this.#timer = null;
      this.recheck();
    }, ms);
    this.#timer.unref();
  }

  #disarm(): void {
    if (this.#timer !== null) clearTimeout(this.#timer);
    this.#timer = null;
  }

  /** Drops the marks that no longer hold. */
  #forget(ledger: Ledger): void {
    for (const [id, cut] of this.#cut) if (!holds(ledger.files.get(id), cut)) this.#cut.delete(id);
  }

  /** Records `standing` for `runId`; whether it changed. */
  #set(runId: string, standing: TierYield | null): boolean {
    const was = this.#standing.get(runId);
    if (standing === null) return this.#standing.delete(runId);
    if (was !== undefined && JSON.stringify(was) === JSON.stringify(standing)) return false;
    this.#standing.set(runId, standing);
    return true;
  }

  #publish(context: SchedulerContext): void {
    const { store, worktreeId } = context;
    writeYieldRow(store, worktreeId, context.now(), this.#history.row(this.#standing));
  }
}

/** `cut` marks `file` still: its key has not moved, and no result landed at it after the cut. */
function holds(file: FileState | undefined, cut: Cut): boolean {
  if (file === undefined || file.key !== cut.key) return false;
  return file.resultKey !== cut.key || file.resultsApplied <= cut.applied;
}

/** The files of `tier` whose module has not ended, as far as the runner said (`Tier.ended`). */
function unfinished(tier: Tier): TierFile[] {
  const { ended } = tier;
  if (ended === undefined || ended.size === 0) return [...tier.files];
  return tier.files.filter(({ file }) => !ended.has(file.id));
}

/**
 * The revisions during its run changed an input of every file of `tier`
 * that has not ended (`Tier.changes`); a tier whose files have all ended
 * is never superseded, its run is over.
 */
function superseded(tier: Tier): boolean {
  if (tier.changes.size === 0) return false;
  const left = unfinished(tier);
  return left.length > 0 && left.every((f) => f.inputs.some((path) => tier.changes.has(path)));
}

/**
 * What waits for `tier` in its lane: `"edit"` when an edit's work queued by
 * a revision after the one it was selected at does, `"promoted"` a promoted
 * file a yield runs sooner (C15) or a focused entry, `"runner"` when
 * `revision` changed an environment input of a project of the lane, whose
 * runner part then waits for the run to recreate the runner (Vitest's
 * `Gate`; #69: "revision 5 not listed yet");
 * `"recheck"` when only promoted files a yield runs nothing sooner for do:
 * held by other worktrees' claims, or with a result stored to take (rows
 * 011-55, 011-123); `"named"` when only promoted files that do not rank
 * before the tier's files do (`beat`, row 011-184).
 */
function waitedFor(
  context: SchedulerContext,
  ledger: Ledger,
  tier: Tier,
  revision: Revision | null,
  beat: Beat,
): Waiting {
  const inLane = (ref: TestFileRef) => laneOf(context, ref) === tier.lane;
  const { queue } = ledger;
  const now = context.now();
  if (queue.hasRecentAfter(tier.revision.number, inLane)) return "edit";
  let later = false;
  let named = false;
  const runsSooner = (ref: TestFileRef) => {
    if (!inLane(ref)) return false;
    if ((queue.rankAt(ref, now)?.rank ?? Infinity) >= beat.rank) {
      named = true;
      return false;
    }
    const claim = peekClaim(context, ledger, ref);
    later ||= claim !== "free";
    return claim === "free";
  };
  if (queue.hasPromoted(runsSooner, now)) return "promoted";
  // Row 011-145 (C4 as amended 2026-10-23): a focused entry, as a promoted file; no claim holds it.
  if (focusedWaiting(context, ledger, inLane)) return "promoted";
  if (revision !== null && recreates(context, ledger, revision, tier.lane)) return "runner";
  return later ? "recheck" : named ? "named" : null;
}

/**
 * Spec 011 C4 step 5 and C15 Rank as amended 2026-10-24 (row 011-184,
 * `tasks/011-180/notes.md` section 6): the rank a promoted file must be
 * below to make `tier` yield. None before the tier has run
 * `YIELD_REMAINDER_MS`; then the least rank of its files that have not
 * ended, a file no open wait selected counting as none. So a wait's file
 * does not cut a file that the same or an earlier wait selected: that wait
 * returns only when each file it selects is current (005 D2).
 */
function rankToBeat(context: SchedulerContext, ledger: Ledger, tier: Tier): Beat {
  const at = context.now();
  let beat: Beat = { rank: Infinity, until: null };
  if (at - (tier.startedAt ?? at) < YIELD_REMAINDER_MS) return beat;
  for (const { file } of unfinished(tier)) {
    const rank = ledger.queue.rankAt(file.ref, at);
    if (rank !== null && rank.rank < beat.rank) beat = rank;
  }
  return beat;
}

/** `revision` changed an environment input of a project with a test file in `lane`. */
function recreates(
  context: SchedulerContext,
  ledger: Ledger,
  revision: Revision,
  lane: string,
): boolean {
  const { keys } = context;
  const inputs = revision.changes
    .map((c) => c.path)
    .filter((path) => keys.isEnvironmentInput(path));
  if (inputs.length === 0) return false;
  const seen = new Set<string>();
  for (const { ref } of ledger.files.values()) {
    if (seen.has(ref.project) || laneOf(context, ref) !== lane) continue;
    seen.add(ref.project);
    const paths = new Set(keys.stabilityPaths(ref));
    if (inputs.some((path) => paths.has(path))) return true;
  }
  return false;
}

/**
 * The tier's estimated remainder: the largest last-known duration among
 * its files that have not ended, a file with none counting 0, less the time
 * it has run. Negative past its estimate.
 */
function remainder(context: SchedulerContext, tier: Tier): number {
  const longest = Math.max(0, ...unfinished(tier).map(({ file }) => file.durationMs ?? 0));
  const now = context.now();
  return longest - (now - (tier.startedAt ?? now));
}

/**
 * Rule B (row 001-381): `tier` yields when its estimated remainder exceeds
 * `YIELD_REMAINDER_MS`, or, as `overruns` allows, once it has run that long
 * past its estimate (row 011-107); else what it waits for.
 */
function byRemainder(context: SchedulerContext, tier: Tier): Decision {
  const remainderMs = remainder(context, tier);
  if (remainderMs > YIELD_REMAINDER_MS) return "yield";
  if (remainderMs >= 0 || !overruns(tier)) return { kind: "remainder", remainderMs };
  if (-remainderMs >= YIELD_REMAINDER_MS) return "yield";
  return { kind: "overrun", yieldsAt: context.now() + remainderMs + YIELD_REMAINDER_MS };
}

/**
 * Whether `tier` may yield past its estimate (row 011-107): it has a file
 * left to cut, as `superseded` needs. A file with no known duration counts
 * 0, so such a tier yields 30 s after its start. The files it cuts run
 * again from their start, apart from the file it yields to (`joinSpan`,
 * row 011-112).
 */
function overruns(tier: Tier): boolean {
  return unfinished(tier).length > 0;
}

/**
 * When a tier that does not yield for `decision` yields at the latest,
 * `YIELD_REMAINDER_MS` past its estimate (row 011-107), or is checked again
 * while only promoted files a yield runs nothing sooner for wait for it (row
 * 011-123), or for `named` when the promotion that gives `beat` passes its
 * deadline (review `reviews/0.1.296.md` B2), so one that passed during the
 * check checks the tier again at once; `null` when nothing
 * but an event changes it: a cut, the backlog's turn, a runner that does
 * not cancel, nothing waiting, or no file left to cut.
 */
function boundOf(
  context: SchedulerContext,
  tier: Tier,
  decision: Exclude<Decision, string>,
  beat: Beat,
): EpochMs | null {
  if (decision?.kind === "recheck") return context.now() + CLAIM_RECHECK_MS;
  if (decision?.kind === "named") return beat.until;
  if (decision?.kind === "overrun") return decision.yieldsAt;
  if (decision?.kind !== "remainder" || !overruns(tier)) return null;
  return context.now() + decision.remainderMs + YIELD_REMAINDER_MS;
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

/** `publishedYieldRow`'s tiers in flight, by run id (row 011-51). */
export function publishedYields(
  store: Store,
  worktreeId: WorktreeId,
  daemonStartedAt: EpochMs,
): ReadonlyMap<string, TierYield> {
  return publishedYieldRow(store, worktreeId, daemonStartedAt).tiers;
}
