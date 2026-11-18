import type { RunEstimate } from "../core/code/gate/estimate.js";
import { changedText } from "../core/commit/at-keys-walk.js";

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
  /** Of those, the ones that ended with a pass or a fail. */
  readonly ran: number;
  /** Of those, the ones the shared store holds at their key after the run (B7). */
  readonly stored: number;
  /** Row 023-18 (D2): why each ran file of a storing run is not stored, one entry per file. */
  readonly notStored: readonly string[];
  /** "Whole-checkout check": the first path the install changed; with one, nothing was stored. */
  readonly changed: string | null;
  /** Row 023-18 (D3): with `changed`, what changed it: git's checkout rules or the install. */
  readonly changedBy: "git" | "install" | null;
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
}

/** Row 023-18 (D2): one line per reason a ran file was not stored, with how many. */
function notStoredLines(reasons: readonly string[], unstored: number): string[] {
  const counts = new Map<string, number>();
  for (const reason of reasons) counts.set(reason, (counts.get(reason) ?? 0) + 1);
  const told = reasons.length;
  if (told < unstored) counts.set("no reason told", unstored - told);
  return [...counts].map(
    ([reason, n]) =>
      `${n} not stored (${reason}); the next --at has no result for ${n === 1 ? "it" : "them"}`,
  );
}

/** Row 023-07: what `--run` ran, of how much budget, and the rerun that fits. */
export function runLines(run: RunUse, at: string): string[] {
  const used = `${(run.usedMs / 1000).toFixed(1)} s of the ${run.timeoutSeconds} s budget`;
  const lines = [
    run.selected === 0
      ? `--run: no file with no result at ${at} to run (${used})`
      : `--run: ${run.ran} of ${run.selected} test files with no result at ${at} ran in its checkout, ${run.stored} stored at its keys (${used})`,
  ];
  const unstored = run.ran - run.stored;
  if (unstored > 0 && run.changed !== null)
    lines.push(
      `${unstored} not stored (${changedText({ path: run.changed, by: run.changedBy ?? "install" })}): ${unstored === 1 ? "its result is" : "their results are"} shown, not ${at}'s`,
    );
  else if (unstored > 0) lines.push(...notStoredLines(run.notStored, unstored));
  const needs = run.notComparable - (run.changed === null ? 0 : unstored);
  if (needs > 0)
    lines.push(`${needs} not run: their closure needs a path git does not hold at ${at}`);
  if (run.rerun !== null)
    lines.push(`${run.notRun} not run (budget). A rerun that fits: ${run.rerun}`);
  return lines;
}
