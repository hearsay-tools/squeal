import type { EpochMs } from "../types/common.js";
import type { CheckKey, TestFileRef } from "../types/keys.js";
import type { Revision } from "../types/revision.js";
import type { CancelCause } from "../types/runner.js";
import type { LastYield, TierYield } from "../types/standing.js";
import { cancelsBacklog } from "./backlog.js";
import { CLAIM_RECHECK_MS, peekClaim } from "./claims.js";
import type { SchedulerContext } from "./context.js";
import type { FileState } from "./files.js";
import { focusedWaiting } from "./focused.js";
import type { Ledger } from "./ledger.js";
import type { CutFiles } from "./sharing.js";
import { laneOf, type Tier, type TierFile } from "./tiers.js";
import { type RankedFile, startsSooner } from "./yield-view.js";

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
 * What waits for a tier in its lane (`waitedFor`): work a yield runs sooner,
 * as a yield names it (`LastYield.to`, row 011-209), or only promoted files
 * a yield runs nothing sooner for, until a claim ends or a stored result is
 * taken, or only promoted files that a file of the tier ranks with or
 * before once it has run 30 s, or that the cut would start no sooner (`named`,
 * rows 011-184 and 011-263).
 */
type Waiting = LastYield["to"] | "recheck" | "named" | null;

/**
 * The rank a promoted file must be below to make a tier yield (`rankToBeat`).
 * A batch's rank does not lapse, so the rank rises only with an event: a
 * file of the tier that ends (row 011-268).
 */
interface Beat {
  readonly rank: number;
  /** The tier's files that have not ended, each with its rank: what a cut queues again (`startsSooner`). */
  readonly files: readonly RankedFile[];
}

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
}

/**
 * Spec 011 C4 step 5 over one clock reading `at` (row 011-194, review
 * `reviews/0.1.296-r2.md` B2): what each tier of `view.tiers` does after
 * `trigger`, the revision just stored, or `null` for runner work applied, a
 * request taken, a tier started beside, a file end or a bound (`yieldReach`).
 * The rules are `TierYields.check`'s. It writes nothing and reads no clock:
 * every lookup it makes reads `at`. `null` while a hold stands: the check
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
  let changed = false;
  for (const tier of view.tiers) {
    const beat = rankToBeat(reading, ledger, tier);
    const decision = decide(reading, ledger, tier, trigger, beat, marks, cuts);
    let yielded: Yielded | null = null;
    if (decision === "yield") {
      const left = remainder(reading, tier);
      const cut = unfinished(tier);
      for (const { file, key } of cut)
        marks.set(file.id, { key, applied: file.resultsApplied, past: left < 0 });
      // Row 011-209: what the yield ran sooner, as `decide` read it, with its own cut marked.
      const to = waitedFor(reading, ledger, tier, trigger, beat, cuts);
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
  return { tiers, marks, standing, changed };
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
  const waiting = waitedFor(context, ledger, tier, revision, beat, cuts);
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

/** `cut` marks `file` still: its key has not moved, and no result landed at it after the cut. */
export function holds(file: FileState | undefined, cut: Cut): boolean {
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
 * before the tier's files do (`beat`, row 011-184), or that a cut would
 * start no sooner than the tier ends (`startsSooner`, row 011-263; `marks`,
 * the files a yield cut so far). For a tier of promoted files only while a
 * file of it has an open promotion (`selected`, row 011-265), an edit's work
 * is not `"edit"`: the other checks run as for any tier, and it is
 * `"named"` when none counts (review `reviews/0.1.377.md` B1).
 */
function waitedFor(
  context: SchedulerContext,
  ledger: Ledger,
  tier: Tier,
  revision: Revision | null,
  beat: Beat,
  marks: CutFiles,
): Waiting {
  const inLane = (ref: TestFileRef) => laneOf(context, ref) === tier.lane;
  const { queue } = ledger;
  const now = context.now();
  const edit = queue.hasRecentAfter(tier.revision.number, inLane);
  // Review 0.1.377 B1: the cut files would go back promoted and run before the edit's work.
  const forWait = edit && tier.promoted === true && selected(beat);
  if (edit && !forWait) return "edit";
  let later = false;
  let named = false;
  // Row 011-263: a promoted file counts only when the cut starts it before the tier's remainder.
  const sooner = (ref: TestFileRef, rank: number) => {
    const file = ledger.file(ref);
    const priority = queue.priorityOf(ref);
    if (file === undefined || priority === null) return false;
    const remainderMs = remainder(context, tier);
    const size = context.policy.runner.tierSize;
    const cut = { files: beat.files, size, past: remainderMs < 0, remainderMs };
    return startsSooner(cut, { file, rank, priority }, marks);
  };
  const runsSooner = (ref: TestFileRef) => {
    if (!inLane(ref)) return false;
    const rank = queue.rankAt(ref, now)?.rank ?? Infinity;
    if (rank >= beat.rank || !sooner(ref, rank)) {
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
  return later ? "recheck" : named || forWait ? "named" : null;
}

/**
 * A file of the tier `beat` reads that has not ended has an open promotion:
 * an open wait selected it (C15). A tier of promoted files only runs on for
 * an edit's work only while this holds (row 011-265, review
 * `reviews/0.1.377.md` B1).
 */
function selected(beat: Beat): boolean {
  return beat.files.some(({ rank }) => rank !== null);
}

/**
 * Spec 011 C4 step 5 and C15 Rank as amended 2026-10-24 (row 011-184,
 * `tasks/011-180/notes.md` section 6) and 2026-10-29 (row 011-268): the
 * rank a promoted file must be below to make `tier` yield, from its start:
 * the least rank of its files that have not ended, a file in no batch
 * counting as none. So a wait's file does not cut a file of the same or an
 * earlier batch: that wait returns only when each file it selects is
 * current (005 D2), and the cut file runs again in its batch's tier, with
 * the file it was cut for, so that file's result lands no sooner and the
 * run is lost. Its `files` hold each of those files' ranks at the same
 * reading (row 011-263). Before row 011-268 a tier had it only once it had
 * run `YIELD_REMAINDER_MS`, or from its start for a tier of promoted files
 * only (row 011-265, request 8b69856d); a batch's rank does not lapse at its
 * wait's deadline, so the rank has none (coordinator, requests bdd8a1ed and
 * 579e56f4).
 */
function rankToBeat(context: SchedulerContext, ledger: Ledger, tier: Tier): Beat {
  const at = context.now();
  const files = unfinished(tier).map(({ file }) => ({
    file,
    rank: ledger.queue.rankAt(file.ref, at),
  }));
  let least = Infinity;
  for (const { rank } of files) if (rank !== null && rank.rank < least) least = rank.rank;
  return { rank: least, files };
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
