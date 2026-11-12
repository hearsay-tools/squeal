import { describe, expect, it } from "vitest";
import type { Overrun } from "../../../src/core/code/gate/progress.js";
import { runsOf } from "../../../src/core/code/gate/runs.js";
import { changedSet, collect, judged, project } from "./collect-fixture.js";

/*
 * Spec 020 D18 as amended (row 020-44, #196) and row 020-43: the starve
 * shape of `research/gate-budget.md`. node:test entry `slow` holds one file
 * that never ends (a deterministic sleep, not host load) and two quick
 * ones; entry `quick` holds two quick files; Vitest holds three. Before,
 * the runners ran one after another, and the slow entry's run held the
 * budget: the quick entry's files and Vitest's never started. Now every
 * runner runs at once, and the two entries share `runner.tierSize` (2)
 * processes, so every file but the slow one completes within the budget,
 * and the slow one is named once while it runs. The verdict rules do not
 * change: its function stays incomplete.
 */

/** Room for a loaded host to start Vitest and node:test, and past the 10 s floor of a name. */
const BUDGET = 25;

describe("collectEvidence: runners at once, one node:test pool (rows 020-43, 020-44)", () => {
  it("completes every other runner's files beside a node:test file that holds the budget", {
    timeout: 180_000,
  }, async () => {
    const root = project("lanes");
    const changed = await changedSet(root, ["src/a.ts", "src/b.ts", "src/c.ts"]);
    const overran: Overrun[] = [];
    const started = performance.now();
    const { evidence } = await collect(root, changed, {
      budgetSeconds: BUDGET,
      overran: (file) => overran.push(file),
    });
    // The deadline ended it, not the 600 s sleep.
    expect(performance.now() - started).toBeLessThan((BUDGET + 30) * 1000);

    expect(evidence.timedOut).toBe(true);
    expect(evidence.testFiles.map((f) => [f.runner, f.path, f.completed, f.failed])).toEqual([
      ["vitest", "test/b1.test.ts", true, []],
      ["vitest", "test/b2.test.ts", true, []],
      ["vitest", "test/b3.test.ts", true, []],
      ["node-test", "n1/q1.test.ts", true, []],
      ["node-test", "n1/q2.test.ts", true, []],
      ["node-test", "n1/slow.test.ts", false, []],
      ["node-test", "n2/c1.test.ts", true, []],
      ["node-test", "n2/c2.test.ts", true, []],
    ]);
    // Named once, while it ran: no stored duration, so at the 10 s floor.
    expect(overran.map((o) => [o.runner, o.path, o.storedSeconds, o.budgetSeconds])).toEqual([
      ["node-test", "n1/slow.test.ts", null, BUDGET],
    ]);
    expect(overran[0]?.seconds).toBeGreaterThanOrEqual(10);
    expect(overran[0]?.usedSeconds).toBeLessThan(BUDGET);
    // It started and was stopped: not finished, and not among the files that never started.
    const runs = runsOf(evidence, {});
    expect(runs.map((r) => [r.runner, r.notFinished, r.notStarted])).toEqual([
      ["vitest", [], undefined],
      ["node-test", ["n1/slow.test.ts"], undefined],
    ]);

    const { report } = await judged(root, changed, evidence);
    expect(report.functions.map((f) => [f.path, f.state, f.gap])).toEqual([
      ["src/a.ts", "incomplete", "not-finished"],
      ["src/b.ts", "pass", null],
      ["src/c.ts", "pass", null],
    ]);
    expect(report.verdict).toBe("incomplete");
  });
});
