import type { CheckKey, TestFileRef } from "../types/keys.js";
import type { Revision } from "../types/revision.js";
import type { LastYield } from "../types/standing.js";
import { readClaim } from "./claims.js";
import type { SchedulerContext } from "./context.js";
import { readFocused } from "./focused.js";
import type { Ledger } from "./ledger.js";
import type { CutFiles } from "./sharing.js";
import { laneOf, type Tier, type TierFile } from "./tiers.js";
import { type RankedFile, startsSooner } from "./yield-view.js";

/*
 * Row 011-354: what waits for a tier in flight, as `decideYields` reads it
 * over one reading (the reading context's `now`).
 */

/**
 * What reading what waits for a tier would have written, in the order it
 * read it, for `TierYields` to write (review 0.1.514 B1): a claim of `key`
 * read at the decision's reading, with the store's fact then, `claimed`
 * (`Claims.record`, row 011-361: its first sight, the waiting flag, or its
 * end), and the focused entries read (`FocusedEntries.waiting`: the
 * waiting ones past their deadline go).
 */
export type Bookkeeping =
  | { readonly kind: "claim"; readonly key: CheckKey; readonly claimed: boolean }
  | { readonly kind: "focused" };

/**
 * What waits for a tier in its lane (`waitedFor`): work a yield runs sooner,
 * as a yield names it (`LastYield.to`, row 011-209), or only promoted files
 * a yield runs nothing sooner for, until a claim ends or a stored result is
 * taken, or only promoted files that a file of the tier ranks with or
 * before once it has run 30 s, or that the cut would start no sooner (`named`,
 * rows 011-184 and 011-263).
 */
export type Waiting = LastYield["to"] | "recheck" | "named" | null;

/**
 * The rank a promoted file must be below to make a tier yield (`rankToBeat`).
 * A batch's rank does not lapse, so the rank rises only with an event: a
 * file of the tier that ends (row 011-268).
 */
export interface Beat {
  readonly rank: number;
  /** The tier's files that have not ended, each with its rank: what a cut queues again (`startsSooner`). */
  readonly files: readonly RankedFile[];
}

/** The files of `tier` whose module has not ended, as far as the runner said (`Tier.ended`). */
export function unfinished(tier: Tier): TierFile[] {
  const { ended } = tier;
  if (ended === undefined || ended.size === 0) return [...tier.files];
  return tier.files.filter(({ file }) => !ended.has(file.id));
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
 * It writes nothing: what its claim and focused reads would have recorded
 * goes to `notes` (review 0.1.514 B1).
 */
export function waitedFor(
  context: SchedulerContext,
  ledger: Ledger,
  tier: Tier,
  revision: Revision | null,
  beat: Beat,
  marks: CutFiles,
  notes: Bookkeeping[],
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
    const { claim, asked, claimed } = readClaim(context, ledger, ref);
    if (asked !== null) notes.push({ kind: "claim", key: asked, claimed });
    later ||= claim !== "free";
    return claim === "free";
  };
  if (queue.hasPromoted(runsSooner, now)) return "promoted";
  // Row 011-145 (C4 as amended 2026-10-23): a focused entry, as a promoted file; no claim holds it.
  const focused = readFocused(context, ledger, inLane);
  if (focused.read) notes.push({ kind: "focused" });
  if (focused.waits) return "promoted";
  if (revision !== null && recreates(context, ledger, revision, tier.lane)) return "runner";
  return later ? "recheck" : named || forWait ? "named" : null;
}

/**
 * A file of the tier `beat` reads that has not ended has an open promotion:
 * an open wait selected it (C15). A tier of promoted files only runs on for
 * an edit's work only while this holds (row 011-265, review
 * `reviews/0.1.377.md` B1).
 */
export function selected(beat: Beat): boolean {
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
export function rankToBeat(context: SchedulerContext, ledger: Ledger, tier: Tier): Beat {
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
export function remainder(context: SchedulerContext, tier: Tier): number {
  const longest = Math.max(0, ...unfinished(tier).map(({ file }) => file.durationMs ?? 0));
  const now = context.now();
  return longest - (now - (tier.startedAt ?? now));
}
