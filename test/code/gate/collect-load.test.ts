import { describe, expect, it } from "vitest";
import type { RunEstimate } from "../../../src/core/code/gate/estimate.js";
import type { BudgetTold } from "../../../src/core/code/gate/plan.js";
import type { ChangedSet } from "../../../src/core/code/gate/types.js";
import type { HostLoad } from "../../../src/core/retry/load.js";
import { changedSet, collect, judged, project, SLOW } from "./collect-fixture.js";
import { OVER, QUIET } from "./host-load.js";

/*
 * Row 020-57 (#212): the D17.1 estimate assumes a free host. Above one
 * one-minute load per CPU, read once through the gate's host-load seam
 * (never real load), every estimate is multiplied by it, and the rerun
 * command and the early stop follow the product. The fixture `early` is
 * #198's shape in node:test: two loaders of the changed function, twenty
 * files that load none. Each is stored at 150 s, so on a free host the
 * run is over the 600 s budget and under twice it: it runs whole.
 */

const LEAVES = ["test/leaf-a.test.mjs", "test/leaf-b.test.mjs"];
const SHARED = Array.from({ length: 20 }, (_, i) => `test/c${String(i).padStart(2, "0")}.test.mjs`);

/** The fixture's change: `src/leaf.mjs`'s function, and `src/shared.mjs` with none. */
async function changedLeaf(root: string): Promise<ChangedSet> {
  const changed = await changedSet(root, ["src/leaf.mjs", "src/shared.mjs"]);
  return { ...changed, functions: changed.functions.filter((f) => f.path === "src/leaf.mjs") };
}

/** The collector over the fixture at `load`, every file stored at 150 s. */
async function gate(load: HostLoad) {
  const root = project("early");
  const changed = await changedLeaf(root);
  const told: { estimates: readonly RunEstimate[]; budget: BudgetTold }[] = [];
  const { evidence } = await collect(root, changed, {
    durations: () => 150,
    hostLoad: () => load,
    estimated: (estimates, _left, budget) => told.push({ estimates, budget }),
  });
  const { report, states } = await judged(root, changed, evidence);
  const run = report.runs.find((r) => r.runner === "node-test");
  return { evidence, told, report, states, run };
}

describe("collectEvidence: the estimate under the host's load (row 020-57)", () => {
  it(
    "at twice the CPU count, doubles the estimate, and the rerun and the early stop follow it",
    SLOW,
    async () => {
      const free = await gate(QUIET);
      const [quiet] = free.told;
      const seconds = quiet?.estimates[0]?.seconds ?? 0;
      // On a free host: over the 600 s budget, under twice it, so every file runs.
      expect(seconds).toBeGreaterThan(600);
      expect(seconds).toBeLessThan(2 * 590);
      expect(quiet?.estimates[0]?.load).toBeUndefined();
      expect(quiet?.budget.fit.early).toBeUndefined();
      expect(free.run?.completed).toHaveLength(22);
      expect(free.report.verdict).toBe("pass");

      const loaded = await gate(OVER);
      const [over] = loaded.told;
      const load = { perCpu: 2, unscaled: seconds };
      expect(over?.estimates).toEqual([{ ...quiet?.estimates[0], seconds: 2 * seconds, load }]);
      expect(over?.budget.fit).toMatchObject({ seconds: 2 * seconds, load, early: true });
      expect(over?.budget.early).toEqual({ run: 2, overBudget: SHARED });
      // The rerun's --timeout covers twice the scaled estimate.
      const rerun = loaded.evidence.rerun?.seconds ?? 0;
      expect(rerun).toBeGreaterThanOrEqual(2 * 2 * seconds);
      expect(rerun).toBeLessThanOrEqual(2 * 2 * seconds + 60 + 60);
      expect(loaded.report.budget.rerun).toEqual(loaded.evidence.rerun);
      // The report keeps the unscaled seconds beside the scaled ones.
      expect(loaded.run?.estimate).toMatchObject({ seconds: 2 * seconds, load });

      // The early stop's own rule, unchanged: the loaders pass the function, the others keep it incomplete.
      expect(loaded.run?.completed).toEqual(LEAVES);
      expect(loaded.run?.overBudget).toEqual(SHARED);
      expect(loaded.states).toEqual([["leaf", "pass", null]]);
      expect(loaded.report.verdict).toBe("incomplete");
    },
  );
});
