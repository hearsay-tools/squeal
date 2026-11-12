import type { Overrun } from "../core/code/gate/progress.js";
import type { GateRunner } from "../core/code/gate/report.js";
import type { GateAdapters } from "../core/code/gate/runners.js";
import { RUNNER_NAMES } from "../core/code/gate/types.js";
import type { RunnerAdapter } from "../core/types/runner.js";

/*
 * Spec 020 rows 020-43 and 020-44 (#196): the gate's runs as they go. The
 * stderr line of a file that runs past its estimate, written once while it
 * still runs, so the file that holds the budget has a name before the
 * report; and each runner kind's run time, with its runs at once.
 */

/**
 * One line: the runner, the file, how long it has run against its stored
 * seconds, and how much of the budget is used. With `--json` it goes to
 * stderr too, as every line but the report does (D14.4).
 */
export function overrunText(file: Overrun): string {
  const stored =
    file.storedSeconds === null
      ? "no stored duration"
      : `stored: ${Math.round(file.storedSeconds)} s`;
  const used = `${file.usedSeconds} s of the ${file.budgetSeconds} s budget used`;
  return `squeal code: ${RUNNER_NAMES[file.runner]} is still running ${file.path} after ${file.seconds} s (${stored}); ${used}\n`;
}

/**
 * The adapters, each runner's `run` timed into `durations` (D7's run
 * durations): the time any run of the runner kind ran, so node:test
 * entries that run at once count once (D18 as amended, row 020-44).
 */
export function timed(
  adapters: GateAdapters,
  durations: Partial<Record<GateRunner, number>>,
): GateAdapters {
  const running = new Map<GateRunner, { count: number; since: number }>();
  const begin = (runner: GateRunner) => {
    const now = running.get(runner) ?? { count: 0, since: performance.now() };
    if (now.count === 0) now.since = performance.now();
    now.count += 1;
    running.set(runner, now);
  };
  const end = (runner: GateRunner) => {
    const now = running.get(runner);
    if (now === undefined) return;
    now.count -= 1;
    if (now.count > 0) return;
    const ms = Math.round(performance.now() - now.since);
    durations[runner] = (durations[runner] ?? 0) + ms;
  };
  const wrap = (runner: GateRunner, adapter: RunnerAdapter): RunnerAdapter =>
    new Proxy(adapter, {
      get(target, key) {
        const value: unknown = Reflect.get(target, key, target);
        if (typeof value !== "function") return value;
        if (key !== "run") return value.bind(target);
        return async (...args: Parameters<RunnerAdapter["run"]>) => {
          begin(runner);
          try {
            return await target.run(...args);
          } finally {
            end(runner);
          }
        };
      },
    });
  return {
    vitest: async (options) => wrap("vitest", await adapters.vitest(options)),
    nodeTest: async (project, options) =>
      wrap("node-test", await adapters.nodeTest(project, options)),
  };
}
