import type { RunEstimate } from "../core/code/gate/estimate.js";
import { changedText } from "../core/commit/at-keys-walk.js";
import type { TakeBackResult } from "../core/types/scheduler.js";
import { maybeStoredText } from "./status-at-report-files.js";
import { noFitText } from "./status-at-run-fit.js";

/*
 * Spec 023 D1 (row 023-07): `--run`'s part of the `status --at` report:
 * its budget use, what it ran, what the store holds after it, and the
 * rerun that fits.
 */

/** Row 023-07, D1: what `--run` used of its budget, and what it ran. */
export interface RunUse {
  readonly timeoutSeconds: number;
  /** From before the checkout to the end of the run, in ms. */
  readonly usedMs: number;
  /** The gate's own time in ms; `null` when it did not start. */
  readonly gateMs: number | null;
  /** The files with no result at their key that the selection chose to run. */
  readonly selected: number;
  /**
   * Row 023-29 (R8): the files with no result at the commit the change did
   * not select, which did not run; absent from a report before it.
   */
  readonly notSelected?: number;
  /** Of those, the ones that ended with a pass or a fail. */
  readonly ran: number;
  /** Of those, the ones the shared store holds at their key after the run (B7). */
  readonly stored: number;
  /** Row 023-18 (D2): why each ran file of a storing run is not stored, one entry per file. */
  readonly notStored: readonly string[];
  /** "Whole-checkout check": the first path the install changed; with one, nothing was stored. */
  readonly changed: string | null;
  /**
   * Row 023-18 (D3): with `changed`, what changed it: git's checkout rules,
   * the install, or (review wave-13 B1) a test of an earlier batch.
   */
  readonly changedBy: "git" | "install" | "run" | null;
  /** Of those, the ones the budget left not run. */
  readonly notRun: number;
  /**
   * Files not comparable with the commit: not run because their closure
   * needs a path git does not hold (D4.9), and, after a changed checkout,
   * those that ran there and were not stored.
   */
  readonly notComparable: number;
  readonly timedOut: boolean;
  /** D17.1's estimate of the selected files; `null` when the checkout gave none. */
  readonly estimate: RunEstimate | null;
  /** 020's rerun line, with a `--timeout` that fits; `null` when every file ran. */
  readonly rerun: string | null;
  /** Row 023-19 (P3): each batch's paths and seconds, its child's start included. */
  readonly batches?: readonly { readonly paths: number; readonly seconds: number }[];
  /** Row 023-29 (R3): each failed batch setup at the commit, with the files it left not run. */
  readonly setupFailed?: readonly SetupCount[];
  /** Files whose node:test `prepare` failed at the commit, not run. */
  readonly notPrepared?: number;
  /** Row 023-29 (R1): the working tree's side of the run; absent when it did not run. */
  readonly now?: NowRunUse;
  /**
   * Row 023-29 (R4): with files the budget left and no `--timeout` up to
   * the cap that fits, what they need in seconds (`null`: unknown) and from
   * what; then `rerun` is `null`.
   */
  readonly rerunNeeds?: { readonly seconds: number | null; readonly from: "rate" | "durations" };
  /**
   * Row 023-34 (T1): the selection clearly could not fit, so nothing ran
   * on either side; `force` is the call that runs what fits anyway.
   */
  readonly refused?: { readonly force: string };
}

/** Row 023-29 (R3): one failed setup, `<group>: <failure>`, and the files it left not run. */
export interface SetupCount {
  readonly setup: string;
  readonly files: number;
}

/** Row 023-29 (R1): what `--run` ran in the working tree. */
export interface NowRunUse {
  /** Through the worktree's daemon, or the gate in the worktree (no daemon serves it). */
  readonly how: "daemon" | "gate";
  /** The files the change selects that had no result in the working tree. */
  readonly selected: number;
  /** Of those, the ones with a pass or a fail now. */
  readonly ran: number;
  /** Of those, the ones the budget left not run (the gate only: the daemon goes on with its). */
  readonly notRun: number;
  /** Its time in ms; `null` when nothing ran. */
  readonly gateMs: number | null;
  readonly setupFailed: readonly SetupCount[];
  /** Why the daemon or the gate gave no result for some files; `null` when none. */
  readonly problem: string | null;
  /** Row 023-34 (T1): what the take-back at the call's end did in the daemon; absent: none. */
  readonly takenBack?: TakeBackResult;
}

/** Row 023-18 (D2): one line per reason a ran file was not stored, with how many. */
function notStoredLines(reasons: readonly string[], unstored: number): string[] {
  const counts = new Map<string, number>();
  for (const reason of reasons) counts.set(reason, (counts.get(reason) ?? 0) + 1);
  const told = reasons.length;
  if (told < unstored) counts.set("no reason told", unstored - told);
  return [...counts].map(([reason, n]) =>
    maybeStoredText(reason)
      ? `${n} not known to be stored (${reason})`
      : `${n} not stored (${reason}); the next --at has no result for ${n === 1 ? "it" : "them"}`,
  );
}

/** Row 023-07: what `--run` ran, of how much budget, and the rerun that fits. */
export function runLines(run: RunUse, at: string): string[] {
  const used = `${(run.usedMs / 1000).toFixed(1)} s of the ${run.timeoutSeconds} s budget`;
  const unselected = run.notSelected ?? 0;
  // R8: with files the change did not select, the count says it is of the selected ones only.
  const which = unselected === 0 ? "" : " that the change selects";
  // T1: nothing ran, R4's line says why, and the call that forces it.
  if (run.refused !== undefined)
    return [
      `--run ran nothing: the ${run.selected} test files with no result at ${at}${which} clearly do not fit the ${run.timeoutSeconds} s budget`,
      ...budgetLines(run, at),
      `To run what fits anyway: ${run.refused.force}; \`--all-missing\` runs every file with no result`,
    ];
  const lines = [
    run.selected === 0
      ? `--run: no file with no result at ${at}${which} to run (${used})`
      : `--run: ${run.ran} of ${run.selected} test files with no result at ${at}${which} ran in its checkout, ${run.stored} stored at its keys (${used})`,
  ];
  if (unselected > 0)
    lines.push(
      `${unselected} more with no result at ${at} not selected by the change did not run; \`--all-missing\` runs ${unselected === 1 ? "it" : "them"}`,
    );
  const unstored = run.ran - run.stored;
  if (unstored > 0 && run.changed !== null)
    lines.push(
      `${unstored} not stored (${changedText({ path: run.changed, by: run.changedBy ?? "install" })}): ${unstored === 1 ? "its result is" : "their results are"} shown, not ${at}'s`,
    );
  else if (unstored > 0) lines.push(...notStoredLines(run.notStored, unstored));
  const needs = run.notComparable - (run.changed === null ? 0 : unstored);
  if (needs > 0)
    lines.push(`${needs} not run: their closure needs a path git does not hold at ${at}`);
  lines.push(...setupLines(run.setupFailed ?? [], ""));
  const notPrepared = run.notPrepared ?? 0;
  if (notPrepared > 0) lines.push(`${notPrepared} not run: their node:test prepare failed`);
  if (run.now !== undefined) lines.push(...nowLines(run.now));
  lines.push(...budgetLines(run, at));
  return lines;
}

/** R3: one line per failed setup, never the budget. */
function setupLines(failed: readonly SetupCount[], side: string): string[] {
  return failed.map((f) => `${side}${f.files} not run: the batch's setup failed (${f.setup})`);
}

/** R1: the working tree's side. */
function nowLines(now: NowRunUse): string[] {
  if (now.selected === 0)
    return ["--run, now: every test file the change selects has a result in the working tree"];
  const how = now.how === "daemon" ? "through this worktree's daemon" : "by the gate in it";
  const lines = [
    `--run, now: ${now.ran} of ${now.selected} test files the change selects with no result in the working tree ran there, ${how}`,
  ];
  lines.push(...setupLines(now.setupFailed, "now: "));
  const without = now.selected - now.ran - now.notRun;
  const setup = now.setupFailed.reduce((n, f) => n + f.files, 0);
  if (now.problem !== null && without - setup > 0)
    lines.push(`now: ${without - setup} without a result: ${now.problem}`);
  lines.push(...takenBackLines(now.takenBack));
  return lines;
}

/** T1: what the call's take-back did in the daemon, one line per kind that has files. */
function takenBackLines(back: TakeBackResult | undefined): string[] {
  if (back === undefined) return [];
  const lines: string[] = [];
  if (back.takenBack > 0) lines.push(`now: ${back.takenBack} not run; taken back from the daemon`);
  if (back.running > 0)
    lines.push(`now: ${back.running} still running in the daemon; their results come later`);
  if (back.kept > 0)
    lines.push(
      `now: ${back.kept} stay queued in the daemon: an edit, a forced run or another wait asked for them`,
    );
  return lines;
}

/** R4: the files the budget left, both sides, with the rerun that fits or what they need. */
function budgetLines(run: RunUse, at: string): string[] {
  const now = run.now?.how === "gate" ? run.now.notRun : 0;
  const left = run.notRun + now;
  if (left === 0) return [];
  const sides =
    now === 0 ? "" : run.notRun === 0 ? ", now" : `: ${run.notRun} at ${at}, ${now} now`;
  const base = `${left} not run (budget${sides})`;
  if (run.rerun !== null) return [`${base}. A rerun that fits: ${run.rerun}`];
  const needs = run.rerunNeeds ?? { seconds: null, from: "durations" as const };
  return [noFitText(base, { needs: needs.seconds, from: needs.from })];
}
