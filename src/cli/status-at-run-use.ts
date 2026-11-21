import type { RunEstimate } from "../core/code/gate/estimate.js";
import type { Changed } from "../core/commit/at-keys-walk.js";
import { shellWord } from "../core/text.js";
import type { RunUse, SideState } from "./status-at-report.js";
import type { NowPart } from "./status-at-run.js";
import type { BatchTime, RunCall } from "./status-at-run-batches.js";
import { rerunFit, type SideFit, setupCounts } from "./status-at-run-fit.js";

/*
 * Spec 023 D1 (rows 023-07, 023-19), moved out of `status-at-run.ts` by
 * row 023-29: `--run`'s budget use for the report, from the commit side's
 * states and the working tree's part, with R4's rerun fit over both sides.
 */

/** What the commit side's run recorded, as `runUse` reads it. */
export interface UseRecord {
  readonly call: RunCall;
  readonly timeoutSeconds: number;
  readonly usedMs: number;
  /** The time spent before the first batch: checkout, install, keying. */
  readonly overheadMs: number;
  readonly gateMs: number | null;
  /** The commit side's states of the files the run decided. */
  readonly states: readonly SideState[];
  readonly selected: number;
  readonly notSelected: number;
  readonly changed: Changed | null;
  readonly timedOut: boolean;
  readonly estimate: RunEstimate | null;
  /** D17.1's estimate of the files the budget left, read while the durations were open. */
  readonly leftSeconds: number | null;
  readonly batches: readonly BatchTime[];
  /** Row 023-34 (T1): the selection clearly could not fit; neither side ran. */
  readonly refused?: { readonly measured: boolean };
}

/** D1's budget use, with the working tree's side when it ran. */
export function runUse(record: UseRecord, now?: NowPart): RunUse {
  const all = record.states;
  const ran = all.filter(
    (s) => s.state === "pass" || s.state === "fail" || (s.state === "not comparable" && s.ran),
  );
  const notRun = all.filter((s) => s.state === "not run" && s.reason === "budget").length;
  const notPrepared = all.filter((s) => s.state === "not run" && s.reason === "prepare").length;
  const here: SideFit = {
    left: notRun,
    ran: ran.length,
    gateMs: record.gateMs,
    estimate: record.leftSeconds,
  };
  // R4: the fit from this run's rate on each side, both sides in one rerun.
  const left = notRun + (now?.use.how === "gate" ? now.use.notRun : 0);
  const fit =
    left === 0 ? null : rerunFit(record.overheadMs, now === undefined ? [here] : [here, now.fit]);
  const { changed } = record;
  return {
    timeoutSeconds: record.timeoutSeconds,
    usedMs: record.usedMs,
    gateMs: record.gateMs,
    selected: record.selected,
    notSelected: record.notSelected,
    ran: ran.length,
    stored: ran.filter((s) => "origin" in s && s.origin.stored === true).length,
    notStored: ran.flatMap((s) =>
      "origin" in s && s.origin.notStored !== undefined ? [s.origin.notStored] : [],
    ),
    changed: changed?.path ?? null,
    changedBy: changed?.by ?? null,
    notRun,
    notComparable: all.filter((s) => s.state === "not comparable").length,
    timedOut: record.timedOut,
    estimate: record.estimate,
    rerun: fit !== null && "seconds" in fit ? rerunCommand(record.call, fit.seconds) : null,
    ...(fit !== null && "needs" in fit
      ? { rerunNeeds: { seconds: fit.needs, from: fit.from } }
      : {}),
    batches: record.batches.map((b) => ({
      paths: b.paths,
      seconds: Math.round(b.seconds * 10) / 10,
    })),
    setupFailed: setupCounts(all),
    ...(notPrepared === 0 ? {} : { notPrepared }),
    // T1: the same call, forced with its own budget, runs what fits.
    ...(record.refused !== undefined
      ? {
          refused: {
            force: rerunCommand(record.call, record.timeoutSeconds),
            measured: record.refused.measured,
          },
        }
      : {}),
    ...(now === undefined ? {} : { now: now.use }),
  };
}

/** 020's rerun line: this call's own arguments with `seconds` as its `--timeout`. */
function rerunCommand(call: RunCall, seconds: number): string {
  const words = [
    "squeal status --at",
    shellWord(call.given),
    ...call.paths.map(shellWord),
    "--run",
    ...(call.allMissing ? ["--all-missing"] : []),
    "--timeout",
    String(seconds),
  ];
  return words.join(" ");
}
