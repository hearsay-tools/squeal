import { estimateRun, type RunEstimate } from "../core/code/gate/estimate.js";
import type { KeyedFile } from "../core/commit/at-keys-checkout.js";
import type { TestFileRef } from "../core/types/keys.js";
import { readPoolView, widthsOf } from "./status-at-estimate.js";

/*
 * Row 023-19 (lessons P3), row 023-40 (D7.3): Q1's estimate of a `--run`
 * not made yet, from the files' stored durations. Row 023-41 removed the
 * in-call run's batches that also lived here. Row 023-49 (V2): `--run`'s
 * own estimate is `status-at-estimate.ts`'s, per side, after the wait;
 * here the width is a side's share of the pool with both sides' daemons
 * at work, not the machine's CPUs.
 */

/**
 * V2: the files one side runs at once when both sides run `files` files:
 * its fair share of the user's pool beside the daemons with work now.
 */
export function runWidth(files: number, env: NodeJS.ProcessEnv = process.env): number {
  const sides = [
    { id: "commit", want: files },
    { id: "now", want: files },
  ];
  return widthsOf(readPoolView(env, []), sides)[0] ?? 1;
}

/** D17.1: the files' estimate from their stored durations, as one Vitest-wide run. */
export function estimateOf(
  files: readonly Pick<KeyedFile, "ref">[],
  durationOf: (ref: TestFileRef) => number | null,
  width = runWidth(files.length),
): RunEstimate {
  return estimateRun("vitest", [{ width, seconds: files.map((f) => durationOf(f.ref)) }]);
}
