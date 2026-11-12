import { type EstimateGroup, estimateRun, median, type RunEstimate } from "./estimate.js";

/*
 * Spec 020 D18 (row 020-19, #187): the order of the gate's runners. Since
 * row 020-44 they run at once (`lanes.ts`), so the order is the one the
 * print lists them in (D18.4), and the order the node:test entries first
 * ask the shared pool for processes in. The runner the estimate calls
 * shorter comes first. The order changes no verdict and no rule.
 */

/** One runner kind's files to run, grouped as D17.1 estimates them; no group when it runs none. */
export interface RunnerFiles {
  readonly runner: RunEstimate["runner"];
  readonly groups: readonly EstimateGroup[];
}

/**
 * D18.2: the runner kinds of `runners` in ascending order of their D17.1
 * estimate. A runner with no stored duration is estimated with each file
 * at the median of every runner's stored durations. When no file has a
 * stored duration, a runner costs its file count. A runner with no file
 * to run costs nothing. Ties keep the order of `runners`.
 */
export function runnerOrder(runners: readonly RunnerFiles[]): RunEstimate["runner"][] {
  const stored = runners.flatMap(({ groups }) =>
    groups.flatMap((g) => g.seconds.filter((s): s is number => s !== null)),
  );
  const middle = median(stored);
  const cost = ({ runner, groups }: RunnerFiles): number => {
    if (middle === null) return groups.reduce((sum, g) => sum + g.seconds.length, 0);
    const own = estimateRun(runner, groups).seconds;
    if (own !== null) return own;
    const atMedian = groups.map((g) => ({ ...g, seconds: g.seconds.map(() => middle) }));
    return estimateRun(runner, atMedian).seconds ?? 0;
  };
  // Array sort is stable: equal costs keep the order given.
  return runners
    .map((r) => ({ runner: r.runner, cost: cost(r) }))
    .sort((a, b) => a.cost - b.cost)
    .map((r) => r.runner);
}
