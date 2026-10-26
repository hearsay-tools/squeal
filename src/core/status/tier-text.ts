import { YIELD_REMAINDER_MS } from "../scheduler/yields.js";
import { timeText } from "../text.js";
import {
  type EpochMs,
  isSlowLane,
  type LastYield,
  SLOW_LANE_PREFIX,
  type WaitedRun,
} from "../types/index.js";

/*
 * Row 011-209 (`research/issue-91.md` F2 to F4, spec 011 C15): how a line
 * words a run in flight, with how many of its files ended, its daemon's last
 * yield, and, on the first tier a daemon started in a lane, that no earlier
 * yield is kept (rule C). The line forms are in `tasks/011-209/notes.md`.
 */

/** `vitest`, or `slow vitest` for a slow lane (004 D2). */
export function laneText(lane: string): string {
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
