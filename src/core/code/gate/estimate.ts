import type { TestFileEvidence } from "./types.js";

/*
 * Spec 020 D17.1 (row 020-17a): how long one runner's run of the gate takes,
 * from the durations the stores hold, told before the first run. It is
 * advice: the run always starts, and the verdict does not read it. The
 * durations are measured on the host that stored them, under its load.
 */

/** Files that run together: up to `width` at once, each with its stored seconds. */
export interface EstimateGroup {
  /** How many of its files run at once; 1 runs them one after another. */
  readonly width: number;
  /** Each file's stored seconds; `null` when the stores hold none. */
  readonly seconds: readonly (number | null)[];
}

/** D17.1, D7's `runs[].estimate`: one runner's estimate. */
export interface RunEstimate {
  readonly runner: TestFileEvidence["runner"];
  /** Whole seconds, rounded up; `null` when no file has a stored duration. */
  readonly seconds: number | null;
  /** The files it runs here: those selected in scope that neither the parts nor the stores gave. */
  readonly files: number;
  /** Of those, the ones with a stored duration; the others count at their median. */
  readonly known: number;
  /** The most of them that run at once: its widest group's width. */
  readonly width: number;
}

/** The middle of `values`, or the mean of the two middle ones; `null` when there is none. */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const half = Math.floor(sorted.length / 2);
  const upper = sorted[half] as number;
  return sorted.length % 2 === 1 ? upper : ((sorted[half - 1] as number) + upper) / 2;
}

/**
 * D17.1: the estimate of `runner`'s run of `groups`, which run one after
 * another. A group takes the larger of its longest file and its summed
 * durations over its width, so a group 1 wide takes its sum. A file with no
 * stored duration counts at the median of the runner's stored ones.
 */
export function estimateRun(
  runner: TestFileEvidence["runner"],
  groups: readonly EstimateGroup[],
): RunEstimate {
  const stored = groups.flatMap((g) => g.seconds.filter((s): s is number => s !== null));
  const files = groups.reduce((sum, g) => sum + g.seconds.length, 0);
  const width = Math.max(1, ...groups.filter((g) => g.seconds.length > 0).map((g) => g.width));
  const middle = median(stored);
  if (middle === null) return { runner, seconds: null, files, known: 0, width };
  let total = 0;
  for (const group of groups) {
    const each = group.seconds.map((s) => s ?? middle);
    const sum = each.reduce((a, b) => a + b, 0);
    const longest = each.reduce((a, b) => Math.max(a, b), 0);
    total += Math.max(longest, sum / Math.max(1, group.width));
  }
  return { runner, seconds: Math.ceil(total), files, known: stored.length, width };
}
