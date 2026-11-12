import { describe, expect, it } from "vitest";
import type { BudgetTold } from "../../../src/core/code/gate/plan.js";
import type { ChangedSet } from "../../../src/core/code/gate/types.js";
import { changedSet, collect, judged, project, SLOW } from "./collect-fixture.js";

/*
 * Rows 020-45 and 020-46 (#196, #198): the fixture `early` is #198's
 * shape in node:test. Two test files load `src/leaf.mjs`, whose function
 * changed; twenty load only `src/shared.mjs`, a changed path with no
 * changed function (as a file a config imports). The stores' durations
 * are the test's own. At twice what is left, the gate runs the two
 * loaders and stops before the twenty, which read not finished, so the
 * function passes and the verdict stays incomplete. Under twice, every
 * file runs. Over the budget either way, the evidence names a rerun whose
 * `--timeout` fits the estimate.
 */

const LEAVES = ["test/leaf-a.test.mjs", "test/leaf-b.test.mjs"];
const SHARED = Array.from({ length: 20 }, (_, i) => `test/c${String(i).padStart(2, "0")}.test.mjs`);

/** The fixture's change: `src/leaf.mjs`'s function, and `src/shared.mjs` with none. */
async function changedLeaf(root: string): Promise<ChangedSet> {
  const changed = await changedSet(root, ["src/leaf.mjs", "src/shared.mjs"]);
  return { ...changed, functions: changed.functions.filter((f) => f.path === "src/leaf.mjs") };
}

/** The collector over the fixture with `budgetSeconds` and every file stored at `seconds(path)`. */
async function gate(budgetSeconds: number, seconds: (path: string) => number) {
  const root = project("early");
  const changed = await changedLeaf(root);
  const told: BudgetTold[] = [];
  const { evidence } = await collect(root, changed, {
    budgetSeconds,
    durations: (ref) => seconds(ref.path),
    estimated: (_estimates, _left, budget) => told.push(budget),
  });
  const { report, states } = await judged(root, changed, evidence);
  const byPath = new Map(evidence.testFiles.map((f) => [f.path, f]));
  const run = report.runs.find((r) => r.runner === "node-test");
  return { evidence, told, report, states, byPath, run };
}

describe("collectEvidence: an estimate over the budget", () => {
  it(
    "at twice what is left, runs the loaders and stops before the files that load no changed function",
    SLOW,
    async () => {
      // 22 files stored at 1000 s each: far over twice the 120 s.
      const { evidence, told, report, states, byPath, run } = await gate(120, () => 1000);

      expect(told).toHaveLength(1);
      const [budget] = told;
      expect(budget?.fit.early).toBe(true);
      expect(budget?.early).toEqual({ run: 2, overBudget: SHARED });
      for (const path of LEAVES) {
        expect(byPath.get(path)).toMatchObject({ completed: true, failed: [] });
      }
      for (const path of SHARED) {
        expect(byPath.get(path)).toMatchObject({
          completed: false,
          overBudget: true,
          record: null,
        });
        // Its closure is read with no run.
        expect(byPath.get(path)?.loads).toContain("src/shared.mjs");
      }
      // Nothing ran out of time: the gate did not start them.
      expect(evidence.timedOut).toBe(false);

      // The function's loaders completed, so it passes; the files not run keep the verdict incomplete.
      expect(states).toEqual([["leaf", "pass", null]]);
      expect(report.verdict).toBe("incomplete");
      expect(run?.completed).toEqual(LEAVES);
      expect(run?.overBudget).toEqual(SHARED);
      expect(run?.notFinished).toEqual([]);

      // The rerun's --timeout covers twice the estimate after the seconds spent.
      const seconds = budget?.fit.seconds ?? 0;
      expect(seconds).toBeGreaterThanOrEqual(1000);
      expect(evidence.rerun?.seconds).toBeGreaterThanOrEqual(2 * seconds);
      expect(evidence.rerun?.seconds).toBeLessThanOrEqual(2 * seconds + 120 + 60);
      expect(evidence.rerun?.command).toBe(
        `squeal code --base HEAD --timeout ${evidence.rerun?.seconds}`,
      );
      expect(report.budget.rerun).toEqual(evidence.rerun);
    },
  );

  it("under twice what is left, runs every file and names the rerun", SLOW, async () => {
    // One file stored at 700 s sets the estimate: over the 600 s, under twice it.
    const { evidence, told, report, byPath, run } = await gate(600, (path) =>
      path === SHARED[0] ? 700 : 0.1,
    );

    const [budget] = told;
    expect(budget?.fit.early).toBeUndefined();
    expect(budget?.early).toBeUndefined();
    expect([...byPath.values()].filter((f) => f.overBudget === true)).toEqual([]);
    expect([...byPath.values()].every((f) => f.completed)).toBe(true);
    expect(report.verdict).toBe("pass");
    expect(run?.completed).toHaveLength(22);
    expect(run?.overBudget).toBeUndefined();
    expect(evidence.rerun?.seconds).toBeGreaterThanOrEqual(2 * 700);
    expect(report.budget.rerun).toEqual(evidence.rerun);
  });
});
