import { median } from "../core/code/gate/estimate.js";
import {
  type GroupEstimate,
  MEASURED_LEAST,
  type SideEstimate,
  type SideWork,
  timeText,
  tooFew,
  type WorkGroup,
} from "./status-at-estimate.js";

/*
 * Row 023-66 (dogfood round 8, V2; spec 023 D3, D7.3): a rate this call
 * measured counts only for the group it was measured in. Round 8 s1 told
 * "about 11 min for 96 test files, at this call's rate there (14 results in
 * 98 s)": the 14 were unit files, the 96 left were browser files at 30 to
 * 135 s each, one at a time, an hour or more. So when the call measured
 * results on a side, each group still to run there is estimated alone:
 *
 * - from its own rate, its results in this call over the call's time, when
 *   at least `MEASURED_LEAST` arrived in it;
 * - else from its own stored durations under V2's rules (`tooFew`), its
 *   own median for a file without one, at its own width;
 * - else its time is unknown, and the text says the call's results came
 *   from other groups.
 *
 * The side takes its longest group's time, unknown when one is unknown.
 * A call that measured nothing on the side (a join, or no result yet) keeps
 * `estimateSide`'s estimate of the whole side.
 */

type Measured = NonNullable<SideWork["measured"]>;

/** The parts of a side's estimate that `byGroup` decides. */
type Split = Pick<
  SideEstimate,
  "seconds" | "basis" | "rate" | "load" | "group" | "elsewhere" | "groups"
>;

/**
 * Each group of `runs` estimated alone, when this call measured results on
 * the side and counted them per group; `null`: `estimateSide` estimates the
 * whole side as before.
 */
export function byGroup(
  runs: readonly WorkGroup[],
  measured: SideWork["measured"],
  width: number,
  factor: number | null,
): Split | null {
  if (measured === null || measured.done === 0 || measured.ms <= 0) return null;
  if (runs.every((g) => g.done === undefined)) return null;
  const parts = runs.map((g, i) => partOf(g, i, measured, width, factor));
  const [only] = parts;
  if (only !== undefined && parts.length === 1) {
    const { group, files: _f, width: _w, known: _k, ...rest } = only;
    const own = runs[0]?.done ?? 0;
    // The files' group is named only when the side measured results in another one too.
    return own === measured.done ? stripGroup(rest) : { ...rest, group };
  }
  const times = parts.map((p) => p.seconds);
  const seconds = times.some((t) => t === null) ? null : Math.max(0, ...(times as number[]));
  return { seconds, basis: "groups", groups: parts };
}

function stripGroup(part: Omit<Split, "group">): Split {
  const { elsewhere: _e, ...rest } = part;
  return rest;
}

/** One group's estimate on a side that measured `measured`. */
function partOf(
  g: WorkGroup,
  index: number,
  measured: Measured,
  width: number,
  factor: number | null,
): GroupEstimate {
  const group = g.name ?? `group ${index + 1}`;
  const files = g.seconds.length;
  const known = g.seconds.filter((s) => s !== null).length;
  const wide = Math.max(1, Math.min(files, groupWidth(g, width)));
  const at = { group, files, width: wide, known };
  const own = g.done ?? 0;
  const seconds = Math.round(measured.ms / 1000);
  if (own >= MEASURED_LEAST) {
    const rated = Math.ceil((files * measured.ms) / 1000 / own);
    const longest = Math.max(0, ...g.seconds.map((s) => s ?? 0));
    const time = Math.max(rated, Math.ceil(longest * (factor ?? 1)));
    return { ...at, seconds: time, basis: "measured", rate: { done: own, seconds } };
  }
  const elsewhere = { done: measured.done, own, seconds };
  const run = tooFew(known, files) ? null : groupedSeconds([g], width);
  if (run === null) return { ...at, seconds: null, basis: "unknown", elsewhere };
  const basis = known * 2 < files ? "guess" : "durations";
  if (factor === null) return { ...at, seconds: run, basis, elsewhere };
  return { ...at, seconds: Math.ceil(run * factor), basis, load: factor, elsewhere };
}

/**
 * Why no rate counts for `e`'s files: `this call measured no rate`, or,
 * when it measured results on the side in other groups, that it did and
 * whose they were.
 */
export function measuredElsewhere(e: SideEstimate): string {
  if (e.elsewhere === undefined || e.group === undefined) return "this call measured no rate";
  const { done, own, seconds } = e.elsewhere;
  return `this call measured no rate for the ${e.group} group (${own} of its ${done} results there in ${seconds} s were that group's)`;
}

/** A side estimated per group: its time, then each group's part. */
export function groupsText(
  e: SideEstimate,
  files: string,
  partText: (part: SideEstimate) => string,
): string {
  const head =
    e.seconds === null ? `${files}, time unknown` : `${timeText(e.seconds)} for ${files}`;
  const parts = (e.groups ?? []).map((p) => `${p.group}: ${partText(p)}`);
  return `${head}, by group: ${parts.join("; ")}`;
}

/** The files of `group` that run at once at a pool share of `width`. */
export function groupWidth(group: WorkGroup, width: number): number {
  const byPool = Math.max(1, Math.floor(width / group.perFile));
  return Math.max(1, Math.min(group.cap ?? byPool, byPool));
}

/**
 * The seconds `groups` take at a pool share of `width`, a file without a
 * stored duration at the median of the stored ones; `null` when none has.
 * The groups run beside each other, so the side takes the longer of all
 * their work over the share and each group's own time: its longest file,
 * its work over its width, and, for a shared `maxParallel` slot, both
 * sides' work of it over the slot.
 */
export function groupedSeconds(groups: readonly WorkGroup[], width: number): number | null {
  const middle = median(
    groups.flatMap((g) => [...g.seconds, ...g.shared]).filter((s): s is number => s !== null),
  );
  if (middle === null) return null;
  const sum = (list: readonly (number | null)[]) =>
    list.reduce<number>((a, s) => a + (s ?? middle), 0);
  let pool = 0;
  let slowest = 0;
  for (const group of groups) {
    const own = sum(group.seconds);
    pool += own * group.perFile;
    const longest = Math.max(0, ...group.seconds.map((s) => s ?? middle));
    const slot =
      group.cap === null || group.shared.length === 0 ? 0 : (own + sum(group.shared)) / group.cap;
    slowest = Math.max(slowest, longest, own / groupWidth(group, width), slot);
  }
  return Math.ceil(Math.max(pool / Math.max(1, width), slowest));
}
