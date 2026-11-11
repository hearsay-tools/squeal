import { describe, expect, it } from "vitest";
import { collectEvidence } from "../../../src/core/code/gate/collect.js";
import type { RunEstimate } from "../../../src/core/code/gate/estimate.js";
import { evaluate } from "../../../src/core/code/gate/evaluate.js";
import { loadBasePolicy } from "../../../src/core/code/gate/policy.js";
import type { GateAdapters } from "../../../src/core/code/gate/runners.js";
import { compare } from "../../../src/core/fs/compare.js";
import type { AbsolutePath } from "../../../src/core/types/common.js";
import type { TestFileRef } from "../../../src/core/types/keys.js";
import type { RunnerAdapter } from "../../../src/core/types/runner.js";
import { createVitestAdapter } from "../../../src/runners/vitest/index.js";
import { ADAPTERS, changedSet, project } from "./collect-fixture.js";
import { TIMES, VERSIONS } from "./evaluate-fixture.js";

/*
 * Spec 020 D17 (row 020-17ab): the collector gives a runner its files in
 * loader order (D17.2) and tells their estimate before the first run
 * (D17.1). The fixture's Vitest runs one file at a time. Its first file by
 * path, `test/a-hub.test.ts`, loads only the hub and never ends (a
 * deterministic sleep, not host load); `test/b-leaf.test.ts` loads the leaf,
 * and the hub through it. In loader order the leaf's function completes
 * within a short budget. In path order, the order the collector used
 * before, it stays not finished. The hub's never completes: one of its
 * loaders never ends.
 */

/** Room for a loaded host to start Vitest and run the leaf's file. */
const BUDGET = 25;

const HUB = "test/a-hub.test.ts";
const LEAF = "test/b-leaf.test.ts";

/** The CLI's adapters; each Vitest run's files go to `events`, sorted by path first when `byPath`. */
function adapters(events: string[], byPath: boolean): GateAdapters {
  const wrap = (adapter: RunnerAdapter): RunnerAdapter =>
    new Proxy(adapter, {
      get(target, key) {
        const value: unknown = Reflect.get(target, key, target);
        if (typeof value !== "function") return value;
        if (key !== "run") return value.bind(target);
        return (files: readonly TestFileRef[], ...rest: unknown[]) => {
          const given = byPath ? [...files].sort((a, b) => compare(a.path, b.path)) : files;
          events.push(`run ${given.map((f) => f.path).join(" ")}`);
          return (value as (...args: unknown[]) => unknown).call(target, given, ...rest);
        };
      },
    });
  return { ...ADAPTERS, vitest: async (options) => wrap(await createVitestAdapter(options)) };
}

/** The collector over the fixture with the budget, then the evaluator: each function's state and gap. */
async function gate(byPath: boolean) {
  const root = project("order") as AbsolutePath;
  const changed = await changedSet(root, ["src/hub.ts", "src/leaf.ts"]);
  const events: string[] = [];
  const told: { estimates: readonly RunEstimate[]; left: number }[] = [];
  const evidence = await collectEvidence(root, changed, {
    tests: [],
    budgetSeconds: BUDGET,
    adapters: adapters(events, byPath),
    // The hub's file is stored as long; the leaf's as short.
    durations: (ref) => (ref.path === HUB ? 600 : 2),
    estimated: (estimates, left) => {
      events.push("estimate");
      told.push({ estimates, left });
    },
  });
  const { policy } = await loadBasePolicy(root, changed.baseCommit);
  const report = evaluate(changed, evidence, policy, VERSIONS, TIMES);
  const states = report.functions.map((f) => [f.path, f.state, f.gap]);
  const completed = evidence.testFiles.map((f) => [f.path, f.completed]);
  return { events, told, evidence, states, completed };
}

describe("collectEvidence: loader order and the estimate (spec 020 D17)", () => {
  it("completes the leaf's function within the budget in loader order", {
    timeout: 180_000,
  }, async () => {
    const ran = await gate(false);

    expect(ran.events).toEqual(["estimate", `run ${LEAF} ${HUB}`]);
    // One file at a time: the sum, 602 s, over what is left of the 25 s budget.
    const estimate = { runner: "vitest", seconds: 602, files: 2, known: 2, width: 1 };
    expect(ran.told).toEqual([{ estimates: [estimate], left: expect.any(Number) }]);
    expect(ran.told[0]?.left).toBeLessThanOrEqual(BUDGET);
    expect(ran.evidence.estimates).toEqual([estimate]);
    expect(ran.evidence.timedOut).toBe(true);
    expect(ran.completed).toEqual([
      [HUB, false],
      [LEAF, true],
    ]);
    expect(ran.states).toEqual([
      ["src/hub.ts", "incomplete", "not-finished"],
      ["src/leaf.ts", "pass", null],
    ]);
  });

  it("leaves the leaf's function not finished in path order", { timeout: 180_000 }, async () => {
    const ran = await gate(true);

    expect(ran.events).toEqual(["estimate", `run ${HUB} ${LEAF}`]);
    expect(ran.completed).toEqual([
      [HUB, false],
      [LEAF, false],
    ]);
    expect(ran.states).toEqual([
      ["src/hub.ts", "incomplete", "not-finished"],
      ["src/leaf.ts", "incomplete", "not-finished"],
    ]);
  });
});
