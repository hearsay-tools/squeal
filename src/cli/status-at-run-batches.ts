import { availableParallelism } from "node:os";
import { estimateRun, type RunEstimate } from "../core/code/gate/estimate.js";
import type { KeyedFile } from "../core/commit/at-keys-checkout.js";
import type { TestFileRef } from "../core/types/keys.js";

/*
 * Row 023-19 (lessons P3), row 023-40 (D7.3): the queueing estimate that
 * `--run` tells, and Q1's probe gives, from the files' stored durations.
 * Row 023-41 removed the in-call run's batches that also lived here.
 */

/** The files Vitest runs at once here, as D17.1's estimate reads them. */
export const runWidth = () => Math.max(1, availableParallelism() - 1);

/** D17.1: the files' estimate from their stored durations, as one Vitest-wide run. */
export function estimateOf(
  files: readonly Pick<KeyedFile, "ref">[],
  durationOf: (ref: TestFileRef) => number | null,
  width = runWidth(),
): RunEstimate {
  return estimateRun("vitest", [{ width, seconds: files.map((f) => durationOf(f.ref)) }]);
}

/**
 * P3: whether `--run` tells the estimate: always with `--all-missing`;
 * else when the selection is large for this machine and the wait: more
 * files than run at once with no stored duration, or an estimate over
 * half the time left.
 */
export function tellsEstimate(estimate: RunEstimate, allMissing: boolean, left: number): boolean {
  if (allMissing) return true;
  if (estimate.seconds === null) return estimate.files > estimate.width;
  return estimate.seconds * 2 > left;
}
