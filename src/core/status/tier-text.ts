import { YIELD_REMAINDER_MS } from "../scheduler/yields.js";
import { durationText, timeText } from "../text.js";
import type { EpochMs } from "../types/common.js";
import { isSlowLane, SLOW_LANE_PREFIX } from "../types/runner.js";
import { GROUP_LANE_PREFIX, laneGroup } from "../types/scheduler.js";
import type { FileOverrun, LastYield, WaitedRun } from "../types/standing.js";

/*
 * Row 011-209 (`research/issue-91.md` F2 to F4, spec 011 C15): how a line
 * words a run in flight, with how many of its files ended, its daemon's last
 * yield, and, on the first tier a daemon started in a lane, that no earlier
 * yield is kept (rule C). The line forms are in `tasks/011-209/notes.md`.
 */

/**
 * `vitest`, or `slow vitest` for a slow lane (004 D2), or `e2e vitest` for
 * a configured group's lane `group:e2e:vitest` (spec 019 D3, row 019-16).
 */
export function laneText(lane: string): string {
  if (lane.startsWith(GROUP_LANE_PREFIX)) {
    const group = laneGroup(lane);
    const runner = lane.slice(GROUP_LANE_PREFIX.length + group.length + 1);
    return runner === "" ? group : `${group} ${runner}`;
  }
  if (!isSlowLane(lane)) return lane;
  const runner = lane.slice(SLOW_LANE_PREFIX.length);
  return runner === "" ? "slow" : `slow ${runner}`;
}

/**
 * `in the vitest tier of 4 test files running since 16:15:46, 1 of them
 * ended`, or `running since 16:15:46 in the vitest lane` for a run of its
 * own (row 011-209, F4: the count once the runner named a file ended).
 */
export function runText(
  lane: string,
  since: number | null,
  files?: number,
  ended?: number,
): string {
  const at = since === null ? "" : ` since ${timeText(since)}`;
  // gh-40 run A: the store cannot tell whether a file of a several-file run has started.
  if (files === undefined || files <= 1) return `running${at} in the ${laneText(lane)} lane`;
  const count = ended === undefined ? "" : `, ${ended} of them ended`;
  return `in the ${laneText(lane)} tier of ${files} test files running${at}${count}`;
}

/**
 * The run an unlisted revision's runner part waits for (row 011-209), as
 * `runText` words it: `the vitest tier of 4 test files running since …`.
 */
export function waitedRunText(run: WaitedRun): string {
  return runText(run.lane, run.since, run.files, run.ended).replace(/^in /, "");
}

const TO: Readonly<Record<LastYield["to"], string>> = {
  edit: "to an edit's work",
  promoted: "to a promoted file",
  runner: "to the runner part",
};

/**
 * `; a yield at 16:15:47 cut 4 files after 1 s of their run (to a promoted
 * file; estimated remainder 199 s, over 30 s)`. The run time is from the cut
 * run's start to when the daemon recorded its end, so at most what the cut
 * discarded; while the run stops, the line says so.
 */
export function keptYieldText(last: LastYield): string {
  const one = last.files.length === 1;
  const cut = one ? "1 file" : `${last.files.length} files`;
  const their = one ? "its" : "their";
  const run =
    last.runEndedAt === null
      ? `; ${their} run since ${timeText(last.runStartedAt)} is still stopping`
      : ` after ${Math.max(0, Math.round((last.runEndedAt - last.runStartedAt) / 1_000))} s of ${their} run`;
  const bound = YIELD_REMAINDER_MS / 1_000;
  const why =
    last.rule === "remainder"
      ? `estimated remainder ${Math.round(last.remainderMs / 1_000)} s, over ${bound} s`
      : `${bound} s past its estimate`;
  return `; a yield at ${timeText(last.at)} cut ${cut}${run} (${TO[last.to]}; ${why})`;
}

/** Rule C: `; no yield kept since the daemon started at 16:15:40`. */
export function noKeptYieldText(since: EpochMs): string {
  return `; no yield kept since the daemon started at ${timeText(since)}`;
}

/** A last-known duration as the overrun words it: `5 ms`, `0.4 s`, `12 s`, `3 min 5 s`. */
function usualText(ms: number): string {
  if (ms < 100) return `${Math.max(1, Math.round(ms))} ms`;
  if (ms < 10_000) return `${Math.round(ms / 100) / 10} s`;
  return durationText(ms);
}

/** `600`, `12,000`: a ratio rounded to two significant digits. */
function timesText(ratio: number): string {
  const digits = Math.max(0, Math.floor(Math.log10(Math.max(1, ratio))) - 1);
  const rounded = Math.round(ratio / 10 ** digits) * 10 ** digits;
  return rounded.toLocaleString("en-US");
}

/**
 * Row 011-399 (gh-233): `; it has run 4 min 2 s, about 600x its usual
 * 0.4 s, so it may be hung; the lane runs its next tiers beside it, and
 * its run's deadline is 16:30:12`. Nothing about its result changes; with
 * no usual time known, the line says so. Row 011-405: while its lane holds
 * two tiers, either tier's file says `it runs beside another tier, so the lane's next
 * tiers wait for one of the two to end` instead, as no third instance opens.
 */
export function overrunText(o: FileOverrun): string {
  const ran = `it has run ${durationText(o.ranMs, Math.floor)}`;
  const usual =
    o.usualMs === null || o.usualMs <= 0
      ? "with no usual time known"
      : `about ${timesText(o.ranMs / o.usualMs)}x its usual ${usualText(o.usualMs)}`;
  const deadline = o.deadline === null ? "" : `, and its run's deadline is ${timeText(o.deadline)}`;
  const lane =
    o.beside === true
      ? "it runs beside another tier, so the lane's next tiers wait for one of the two to end"
      : "the lane runs its next tiers beside it";
  return `; ${ran}, ${usual}, so it may be hung; ${lane}${deadline}`;
}
