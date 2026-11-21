import type { RunEstimate } from "../core/code/gate/estimate.js";
import type { SideState } from "./status-at-report.js";

/*
 * Row 023-29 (lessons round 4, R4): the rerun line's `--timeout` from the
 * rate this run measured, per side. In round 4, 31 of 1,338 files ran in
 * 301 s and the report offered `--timeout 600` for the 1,307 left; at
 * that rate they need hours. A side's rate is the files that ended with a
 * pass or a fail over its gate children's time; a side where none ended
 * falls back on its stored durations' estimate. The rerun gets the time
 * spent before the run plus `MARGIN` times what the left files need. When
 * that is over `RERUN_CAP_SECONDS`, no `--timeout` fits and the report
 * says how long they need instead.
 */

/**
 * The longest `--timeout` a rerun line offers: the longest tool call an
 * agent's shell gives (Claude Code's Bash, 600 s; `RUN_TIMEOUT_SECONDS`).
 * A longer call moves to the background and the agent loses the answer.
 */
export const RERUN_CAP_SECONDS = 600;

/** What the rerun gives the left files over what this run's rate says they need. */
const MARGIN = 1.5;

/** One side's part in the fit. */
export interface SideFit {
  /** Its files the budget left not run. */
  readonly left: number;
  /** Its files that ended with a pass or a fail in this run. */
  readonly ran: number;
  /** Its gate children's time in ms; `null` when none started. */
  readonly gateMs: number | null;
  /** D17.1's estimate of its left files, in seconds; `null` when none has a stored duration. */
  readonly estimate: number | null;
}

/**
 * The rerun's fit: a `--timeout` in whole minutes, or what the left files
 * need (`null` when neither a rate nor a stored duration tells it) and
 * from what.
 */
export type Fit =
  | { readonly seconds: number }
  | { readonly needs: number | null; readonly from: "rate" | "durations" };

/** R4: the fit for `sides`, after `overheadMs` spent before the run (checkout, install, keying). */
export function rerunFit(
  overheadMs: number,
  sides: readonly SideFit[],
  cap = RERUN_CAP_SECONDS,
): Fit {
  let needs = 0;
  let from: "rate" | "durations" = "durations";
  for (const side of sides) {
    if (side.left === 0) continue;
    const seconds = (side.gateMs ?? 0) / 1000;
    if (side.ran > 0 && seconds > 0) {
      needs += side.left / (side.ran / seconds);
      from = "rate";
    } else if (side.estimate !== null) needs += side.estimate;
    else return { needs: null, from };
  }
  const total = overheadMs / 1000 + MARGIN * needs;
  const minutes = Math.max(60, Math.ceil(total / 60) * 60);
  if (minutes <= cap) return { seconds: minutes };
  return { needs: Math.round(overheadMs / 1000 + needs), from };
}

/**
 * Row 023-34 (T1): with no stored duration, the seconds one round of
 * files at once is taken to need at the least when the selection's fit is
 * judged before it runs: a round of `width` files per this many seconds
 * of the budget is the most it can hold.
 */
const ROUND_SECONDS = 20;

/**
 * Row 023-34 (T1, lessons round 5; spec 023 D4.11): whether `estimate`'s
 * selection clearly cannot fit before it runs, `overheadMs` spent and a
 * budget of `budgetSeconds`: R4's estimate is above the cap; or no file
 * has a stored duration and there are more of them than one round of
 * files at once per `ROUND_SECONDS` of the budget holds. In round 5, the
 * second case was 1,338 files at width 11 in 300 s (165 at the most);
 * 111 files in squawk ran and answered.
 */
export function clearlyOver(estimate: RunEstimate, overheadMs: number, budgetSeconds: number) {
  if (estimate.files === 0) return false;
  if (estimate.seconds !== null) {
    const side = { left: estimate.files, ran: 0, gateMs: null, estimate: estimate.seconds };
    return "needs" in rerunFit(overheadMs, [side]);
  }
  const rounds = Math.max(1, Math.floor(budgetSeconds / ROUND_SECONDS));
  return estimate.files > estimate.width * rounds;
}

/** About `seconds` in words: seconds, minutes or hours. */
export function aboutText(seconds: number): string {
  if (seconds < 120) return `${Math.max(1, Math.round(seconds))} s`;
  if (seconds < 120 * 60) return `${Math.round(seconds / 60)} min`;
  return `${Math.round(seconds / 3600)} h`;
}

/**
 * R4: the line for the files the budget left (`notRun`: "1307 not run
 * (budget)", with the sides when both have some) when no `--timeout` up to
 * the cap fits.
 */
export function noFitText(notRun: string, fit: Extract<Fit, { needs: unknown }>): string {
  const narrow = "name test files or folders to narrow it";
  if (fit.needs === null)
    return `${notRun}; no file ended in this run and none has a stored duration, so the time they need is unknown; ${narrow}`;
  const how = fit.from === "rate" ? "at this run's rate" : "from their stored durations";
  return `${notRun}; ${how} they need about ${aboutText(fit.needs)}; ${narrow}`;
}

/** The side's files that ended with a pass or a fail, run here or not stored. */
export function ranCount(states: Iterable<SideState>): number {
  let n = 0;
  for (const s of states)
    if (s.state === "pass" || s.state === "fail" || (s.state === "not comparable" && s.ran)) n++;
  return n;
}

/** R3: each distinct failed setup, with how many files it left not run. */
export function setupCounts(
  states: Iterable<SideState>,
): { readonly setup: string; readonly files: number }[] {
  const counts = new Map<string, number>();
  for (const s of states)
    if (s.state === "not run" && s.reason === "setup") {
      const setup = s.setup ?? "no text";
      counts.set(setup, (counts.get(setup) ?? 0) + 1);
    }
  return [...counts].map(([setup, files]) => ({ setup, files }));
}
