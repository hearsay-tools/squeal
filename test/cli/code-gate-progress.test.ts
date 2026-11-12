import { describe, expect, it } from "vitest";
import { ADAPTERS } from "../../src/cli/code-gate.js";
import { overrunText, timed } from "../../src/cli/code-gate-progress.js";
import type { GateRunner } from "../../src/core/code/gate/report.js";
import type { GateAdapters } from "../../src/core/code/gate/runners.js";
import type { RunnerAdapter, RunReport } from "../../src/core/types/runner.js";

/*
 * Spec 020 rows 020-43 and 020-44 (#196): the stderr line that names a file
 * running past its estimate, and each runner kind's run time when its runs
 * overlap.
 */

describe("overrunText (row 020-43)", () => {
  it("names the runner, the file, its time against its stored time, and the budget used", () => {
    const base = { path: "n1/slow.test.ts", seconds: 229, usedSeconds: 240, budgetSeconds: 600 };
    expect(overrunText({ ...base, runner: "node-test", storedSeconds: 207.4 })).toBe(
      "squeal code: node:test is still running n1/slow.test.ts after 229 s (stored: 207 s); 240 s of the 600 s budget used\n",
    );
    expect(overrunText({ ...base, runner: "vitest", storedSeconds: null })).toBe(
      "squeal code: Vitest is still running n1/slow.test.ts after 229 s (no stored duration); 240 s of the 600 s budget used\n",
    );
  });
});

/** An adapter whose runs end when `end` is called. */
function waitingAdapter(): { adapter: RunnerAdapter; end: () => void } {
  const ends: (() => void)[] = [];
  const report: RunReport = {
    end: "completed",
    durationMs: 0,
    completedFiles: [],
    results: [],
    fileErrors: [],
    failure: null,
  };
  const adapter = {
    run: () => new Promise<RunReport>((resolve) => ends.push(() => resolve(report))),
  } as unknown as RunnerAdapter;
  return { adapter, end: () => ends.shift()?.() };
}

describe("timed (row 020-44)", () => {
  it("counts the time any run of a runner kind ran, once for runs at once", async () => {
    const waiting = waitingAdapter();
    const durations: Partial<Record<GateRunner, number>> = {};
    const adapters = timed({ ...ADAPTERS, vitest: async () => waiting.adapter }, durations);
    const options = {} as Parameters<GateAdapters["vitest"]>[0];
    const adapter = await adapters.vitest(options);
    const since = performance.now();
    const run = () => adapter.run([], { runId: "r", logDir: "/l", timeoutMs: null });
    const runs = [run(), run()];
    await new Promise((r) => setTimeout(r, 120));
    waiting.end();
    await runs[0];
    expect(durations.vitest).toBeUndefined();
    await new Promise((r) => setTimeout(r, 120));
    waiting.end();
    await runs[1];
    const wall = performance.now() - since;

    // One span, the wall time of both; summed, the first run's 120 ms or more would count twice.
    const ms = durations.vitest ?? 0;
    expect(ms).toBeGreaterThanOrEqual(230);
    expect(ms).toBeLessThanOrEqual(Math.ceil(wall) + 1);
  });
});
