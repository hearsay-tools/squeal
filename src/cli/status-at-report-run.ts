import type { RunEstimate } from "../core/code/gate/estimate.js";

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
  /** Of those, the ones the budget left not run. */
  readonly notRun: number;
  /** Files with no result that were not run because their closure needs a path git does not hold. */
  readonly notComparable: number;
  readonly timedOut: boolean;
  /** D17.1's estimate of the selected files; `null` when the checkout gave none. */
  readonly estimate: RunEstimate | null;
  /** 020's rerun line, with a `--timeout` that fits; `null` when every file ran. */
  readonly rerun: string | null;
}

/** Row 023-07: what `--run` ran, of how much budget, and the rerun that fits. */
export function runLines(run: RunUse, at: string): string[] {
  const used = `${(run.usedMs / 1000).toFixed(1)} s of the ${run.timeoutSeconds} s budget`;
  const lines = [
    run.selected === 0
      ? `--run: no file with no result at ${at} to run (${used})`
      : `--run: ${run.ran} of ${run.selected} test files with no result at ${at} ran in its checkout, ${run.stored} stored at its keys (${used})`,
  ];
  if (run.ran > run.stored)
    lines.push(
      `${run.ran - run.stored} not stored: the gate keeps a result only with coverage on at ${at}; the next --at has no result for ${run.ran - run.stored === 1 ? "it" : "them"}`,
    );
  if (run.notComparable > 0)
    lines.push(
      `${run.notComparable} not run: their closure needs a path git does not hold at ${at}`,
    );
  if (run.rerun !== null)
    lines.push(`${run.notRun} not run (budget). A rerun that fits: ${run.rerun}`);
  return lines;
}
