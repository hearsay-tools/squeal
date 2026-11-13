import type { TestFileEvidence } from "./types.js";

/*
 * Spec 020 D17.1 (row 020-17a): how long one runner's run of the gate takes,
 * from the durations the stores hold, told before the first run. The
 * verdict does not read it. The durations are measured on the host that
 * stored them, under its load. Rows 020-45 and 020-46 (#196, #198): over
 * what is left of the budget, it names a rerun `--timeout` that fits; at
 * twice what is left, the gate runs only the files that may load a changed
 * function. A summed estimate over 20 or more files is more than 2x wrong
 * in about 2.5% of 11,813 stored runs (`research/gate-budget.md`, Q2).
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

/** Row 020-45: a rerun's `--timeout` gives the run this many times its estimate. */
export const RERUN_FACTOR = 2;

/** Row 020-46: the gate stops early when the estimate is at least this many times what is left. */
export const EARLY_FACTOR = 2;

/** Row 020-46: ... and at least this many files to run have a stored duration. */
export const EARLY_KNOWN = 20;

/**
 * D18 as amended (row 020-44): the run's estimate from each runner's
 * estimate. The runners run at once, so it is the larger one.
 */
export function runSeconds(runners: readonly number[]): number {
  return runners.reduce((longest, seconds) => Math.max(longest, seconds), 0);
}

/** One runner kind's files to run, grouped as `estimateRun` takes them. */
export interface RunnerGroups {
  readonly runner: TestFileEvidence["runner"];
  readonly groups: readonly EstimateGroup[];
}

/**
 * Rows 020-45, 020-46: the estimate of the whole run, over `runners`. A
 * runner with a stored duration takes its own estimate (D17.1); one with
 * none counts each file at the median of every runner's stored durations,
 * as D18.2 orders it. `seconds` is `null` when no file has a stored
 * duration; `known` counts the files that have one.
 */
export function estimateAll(runners: readonly RunnerGroups[]): {
  readonly seconds: number | null;
  readonly known: number;
} {
  const stored = runners.flatMap(({ groups }) =>
    groups.flatMap((g) => g.seconds.filter((s): s is number => s !== null)),
  );
  const middle = median(stored);
  if (middle === null) return { seconds: null, known: 0 };
  const each = runners.map(({ runner, groups }) => {
    const own = estimateRun(runner, groups).seconds;
    if (own !== null) return own;
    const atMedian = groups.map((g) => ({ ...g, seconds: g.seconds.map(() => middle) }));
    return estimateRun(runner, atMedian).seconds ?? 0;
  });
  return { seconds: runSeconds(each), known: stored.length };
}

/** D17.1, rows 020-45 and 020-46: the run's estimate against what is left of the budget. */
export interface BudgetFit {
  /** Whole seconds left of the budget when the estimate is told. */
  readonly leftSeconds: number;
  /** The whole run's estimate in whole seconds (`estimateAll`); `null` when no file has a stored duration. */
  readonly seconds: number | null;
  /** Of the files to run, those with a stored duration. */
  readonly known: number;
  /**
   * Row 020-45: the `--timeout` of a rerun that fits, when the estimate is
   * over what is left: the seconds spent before the first run plus
   * `RERUN_FACTOR` times the estimate, rounded up to a whole minute.
   * Absent when the run fits, or its time is unknown.
   */
  readonly rerunSeconds?: number;
  /**
   * Row 020-46: the estimate is at least `EARLY_FACTOR` times what is
   * left, from at least `EARLY_KNOWN` stored durations: the gate runs only
   * the files that may load a changed function. Absent otherwise.
   */
  readonly early?: true;
}

/**
 * Rows 020-45, 020-46: how `run`, the whole run's estimate, stands
 * against the `leftSeconds` of a budget of `budgetSeconds`.
 */
export function fitBudget(
  run: { readonly seconds: number | null; readonly known: number },
  budget: { readonly budgetSeconds: number; readonly leftSeconds: number },
): BudgetFit {
  const { seconds, known } = run;
  const { leftSeconds } = budget;
  const fit = { leftSeconds, seconds, known };
  if (seconds === null || seconds <= leftSeconds) return fit;
  const spent = Math.max(0, budget.budgetSeconds - leftSeconds);
  const rerunSeconds = Math.ceil((spent + RERUN_FACTOR * seconds) / 60) * 60;
  const early = seconds >= EARLY_FACTOR * leftSeconds && known >= EARLY_KNOWN;
  return { ...fit, rerunSeconds, ...(early ? { early: true as const } : {}) };
}
