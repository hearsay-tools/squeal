import type { EpochMs } from "../types/common.js";
import type { CheckKey } from "../types/keys.js";
import type { Revision } from "../types/revision.js";
import type { CancelCause } from "../types/runner.js";
import type { LastYield, TierYield } from "../types/standing.js";
import { cancelsBacklog } from "./backlog.js";
import { CLAIM_RECHECK_MS } from "./claims.js";
import type { SchedulerContext } from "./context.js";
import type { FileState } from "./files.js";
import { leadCut } from "./lead-cut.js";
import type { Ledger } from "./ledger.js";
import type { CutFiles } from "./sharing.js";
import type { Tier, TierFile } from "./tiers.js";
import {
  type Beat,
  type Bookkeeping,
  rankToBeat,
  remainder,
  selected,
  unfinished,
  waitedFor,
} from "./yield-waits.js";

/*
 * Row 011-354 (card 7, `research/scheduler-step.md`, "The yield split"):
 * the decide half of the yield check. `decideYields` reads one clock
 * reading, the trigger and a view of the tiers in flight, and writes
 * nothing; `TierYields` keeps the state and applies what it returns.
 */

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
export type YieldDecision =
  | Extract<CancelCause, "supersession" | "backlog" | "yield">
  | TierYield
  | typeof RECHECK
  | null;

/**
 * A yield cut a file at `key` when it had `applied` results
 * (`FileState.resultsApplied`); `past` when its tier had run past its
 * estimate (`overruns`, row 011-107).
 */
export interface Cut {
  readonly key: CheckKey;
  readonly applied: number;
  readonly past: boolean;
}

/** What the yield check reads beside the clock reading and the trigger. */
export interface YieldView {
  readonly context: SchedulerContext;
  readonly ledger: Ledger;
  /** The tiers in flight, decided in this order: a later tier reads the marks an earlier one set. */
  readonly tiers: readonly Tier[];
  /** The files a yield cut, by `testFileId`, before this check (`TierYields`). */
  readonly marks: ReadonlyMap<string, Cut>;
  /** What each tier in flight does for a wait in its lane, by run id, as last published. */
  readonly standing: ReadonlyMap<string, TierYield>;
  /**
   * A hold stands (admission's `held` halt): a tier in flight when a hold
   * begins runs to its end, and nothing would start instead (row 011-72).
   * Read in the lock turn the check runs in, so a queued check reads it
   * when it runs.
   */
  readonly held: boolean;
}

/** A yield the history records (`YieldHistory.yielded`, row 011-209). */
export interface Yielded {
  /** What the yield ran sooner, read after its own cut. */
  readonly to: LastYield["to"];
  /** The tier's estimated remainder at the yield; negative past its estimate. */
  readonly remainderMs: number;
  /** The files it cut. */
  readonly cut: readonly TierFile[];
}

/** What the check decided for one tier in flight. */
export interface TierDecision {
  readonly tier: Tier;
  /** A string cancels the tier for that cause; else what it does for a wait. */
  readonly decision: YieldDecision;
  /** When it is checked again with no event (`boundOf`); `null` for none. */
  readonly bound: EpochMs | null;
  /** The yield the history records, or `null`. */
  readonly yielded: Yielded | null;
}

/** What one yield check decided, for `TierYields` to apply. */
export interface YieldDecisions {
  /** One per tier in flight, in the view's order. */
  readonly tiers: readonly TierDecision[];
  /** The marks after the check: the ones that still hold, and this check's cuts. */
  readonly marks: ReadonlyMap<string, Cut>;
  /** The standings after the check, by run id. */
  readonly standing: ReadonlyMap<string, TierYield>;
  /** The published row changes: a standing changed or the history took a yield. */
  readonly changed: boolean;
  /**
   * What its claim and focused reads would have written, in the order it
   * read them, for `TierYields` to write before it applies the tiers'
   * decisions (review 0.1.514 B1).
   */
  readonly bookkeeping: readonly Bookkeeping[];
}

/**
 * Spec 011 C4 step 5 over one clock reading `at` (row 011-194, review
 * `reviews/0.1.296-r2.md` B2): what each tier of `view.tiers` does after
 * `trigger`, the revision just stored, or `null` for runner work applied, a
 * request taken, a tier started beside, a file end or a bound (`yieldReach`).
 * The rules are `TierYields.check`'s. It writes nothing and reads no clock:
 * every lookup it makes reads `at`, and what the claim and focused reads
 * would have recorded is returned as `bookkeeping` (review 0.1.514 B1), so
 * a decision can be discarded or replayed. `null` while a hold stands: the check
 * does nothing, not even drop a mark (row 011-72).
 */
export function decideYields(
  at: EpochMs,
  trigger: Revision | null,
  view: YieldView,
): YieldDecisions | null {
  if (view.held) return null;
  const { ledger } = view;
  const reading: SchedulerContext = { ...view.context, now: () => at };
  const marks = new Map<string, Cut>();
  for (const [id, cut] of view.marks) if (holds(ledger.files.get(id), cut)) marks.set(id, cut);
  const cuts: CutFiles = {
    cutPastEstimate: (file) => {
      const cut = marks.get(file.id);
      return cut?.past === true && holds(file, cut);
    },
  };
  const standing = new Map(view.standing);
  const tiers: TierDecision[] = [];
  const bookkeeping: Bookkeeping[] = [];
  let changed = false;
  for (const tier of view.tiers) {
    const beat = rankToBeat(reading, ledger, tier);
    const decision = decide(reading, ledger, tier, trigger, beat, marks, cuts, bookkeeping);
    let yielded: Yielded | null = null;
    if (decision === "yield") {
      // Row 023-60: read before this cut marks the tier's files.
      const lead = leadsInside(reading, ledger, tier, marks);
      const left = remainder(reading, tier);
      const cut = unfinished(tier);
      for (const { file, key } of cut)
        marks.set(file.id, { key, applied: file.resultsApplied, past: left < 0 });
      // Row 011-209: what the yield ran sooner, as `decide` read it, with its own cut marked.
      // Row 023-60: a cut for a leading batch inside the tier ran a promoted file sooner.
      const to = lead
        ? "promoted"
        : waitedFor(reading, ledger, tier, trigger, beat, cuts, bookkeeping);
      if (to === "edit" || to === "promoted" || to === "runner") {
        yielded = { to, remainderMs: left, cut };
        changed = true;
      }
    }
    const next =
      typeof decision === "string"
        ? { kind: "yields" as const }
        : decision?.kind === "recheck"
          ? null
          : decision;
    changed = setStanding(standing, tier.runId, next) || changed;
    const bound = typeof decision === "string" ? null : boundOf(at, tier, decision);
    tiers.push({ tier, decision, bound, yielded });
  }
  return { tiers, marks, standing, changed, bookkeeping };
}

/** Records `next` for `runId` in `standing`; whether it changed. */
function setStanding(
  standing: Map<string, TierYield>,
  runId: string,
  next: TierYield | null,
): boolean {
  const was = standing.get(runId);
  if (next === null) return standing.delete(runId);
  if (was !== undefined && JSON.stringify(was) === JSON.stringify(next)) return false;
  standing.set(runId, next);
  return true;
}

function decide(
  context: SchedulerContext,
  ledger: Ledger,
  tier: Tier,
  revision: Revision | null,
  beat: Beat,
  marks: ReadonlyMap<string, Cut>,
  cuts: CutFiles,
  bookkeeping: Bookkeeping[],
): YieldDecision {
  const { cancel } = tier;
  if (tier.kind === "slow") return null;
  if (cancel?.signal.aborted === true) return { kind: "yields" };
  if (cancel !== null && superseded(tier)) return "supersession";
  // Row 011-145: a focused tier leads its lane, so it yields to nothing.
  if (tier.kind === "focused") return null;
  if (tier.kind === "backlog" && cancel !== null) {
    if (cancelsBacklog(context, ledger, revision, tier, selected(beat))) return "backlog";
  }
  // Row 023-60 (W3): a leading batch's file inside a wider tier runs next, alone.
  if (leadsInside(context, ledger, tier, marks)) return "yield";
  const waiting = waitedFor(context, ledger, tier, revision, beat, cuts, bookkeeping);
  if (waiting === null) return null;
  if (cancel === null || tier.slot === true)
    return waiting === "recheck" ? null : { kind: "runner" };
  if (waiting === "recheck") return RECHECK;
  if (tier.kind === "turn") return { kind: "turn" };
  if (unfinished(tier).some(({ file, key }) => marks.get(file.id)?.key === key))
    return { kind: "cut" };
  if (waiting === "named") return { kind: "named" };
  return byRemainder(context, tier);
}

/** Row 023-60: `leadCut` with the marks that hold before this check and rule B's margin. */
function leadsInside(
  context: SchedulerContext,
  ledger: Ledger,
  tier: Tier,
  marks: ReadonlyMap<string, Cut>,
): boolean {
  const marked = ({ file, key }: TierFile) => {
    const cut = marks.get(file.id);
    return cut !== undefined && cut.key === key && holds(file, cut);
  };
  return leadCut(context, ledger, tier, marked, YIELD_REMAINDER_MS);
}

/** `cut` marks `file` still: its key has not moved, and no result landed at it after the cut. */
export function holds(file: FileState | undefined, cut: Cut): boolean {
  if (file === undefined || file.key !== cut.key) return false;
  return file.resultKey !== cut.key || file.resultsApplied <= cut.applied;
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
 * Rule B (row 001-381): `tier` yields when its estimated remainder exceeds
 * `YIELD_REMAINDER_MS`, or, as `overruns` allows, once it has run that long
 * past its estimate (row 011-107); else what it waits for.
 */
function byRemainder(context: SchedulerContext, tier: Tier): YieldDecision {
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
 * 011-123); `null` when nothing but an event changes it: a cut, the
 * backlog's turn, a runner that does not cancel, nothing waiting, no file
 * left to cut, or for `named` a file of the tier that ends, since a batch's
 * rank does not lapse (row 011-268).
 */
function boundOf(
  at: EpochMs,
  tier: Tier,
  decision: Exclude<YieldDecision, string>,
): EpochMs | null {
  if (decision?.kind === "recheck") return (at + CLAIM_RECHECK_MS) as EpochMs;
  if (decision?.kind === "overrun") return decision.yieldsAt;
  if (decision?.kind !== "remainder" || !overruns(tier)) return null;
  return (at + decision.remainderMs + YIELD_REMAINDER_MS) as EpochMs;
}
