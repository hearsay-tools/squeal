import { describe, expect, it } from "vitest";
import { EARLY_KNOWN } from "../../../src/core/code/gate/estimate.js";
import {
  budgetTold,
  defaultRerun,
  fitOrder,
  inLoaderOrder,
  orderRuns,
} from "../../../src/core/code/gate/plan.js";
import type { Picked } from "../../../src/core/code/gate/prerun.js";
import type { RelativePath } from "../../../src/core/types/common.js";
import type { TestFileRef } from "../../../src/core/types/keys.js";
import type { RunnerAdapter } from "../../../src/core/types/runner.js";

/*
 * Rows 020-45 and 020-46 (#196, #198): the plan fits the whole run's
 * estimate to what is left of the budget. Over it, the estimate names a
 * rerun with a fitted `--timeout`. At twice it, from enough stored
 * durations, each run keeps only the files that may load a changed
 * function, and the others are its `overBudget`; under twice, nothing is
 * left out. The adapters here only give closures: nothing runs.
 */

const ref = (path: string): TestFileRef => ({ project: "", path });

/** A runner of `kind` whose selection is `files`, each with the closure `loads` gives. */
function pick(
  kind: Picked["kind"],
  files: readonly string[],
  loads: Readonly<Record<string, readonly string[]>>,
  byInputs: readonly string[] = [],
): Picked {
  const adapter = {
    closure: async (r: TestFileRef) => {
      const paths = loads[r.path];
      if (paths === undefined) throw new Error(`no closure for ${r.path}`);
      return { paths };
    },
  } as unknown as RunnerAdapter;
  const run = files.map(ref);
  const chosen = byInputs.length === 0 ? {} : { byInputs: byInputs.map(ref) };
  return { kind, adapter, listed: run, run, leftOut: [], ...chosen };
}

/** `count` test files under `dir` that each load `loads`. */
const many = (dir: string, count: number) =>
  Array.from({ length: count }, (_, i) => `${dir}/f${String(i).padStart(3, "0")}.test.ts`);

const LEAF = "src/leaf.ts" as RelativePath;

/**
 * #198's shape: two loaders of the changed function's path, then
 * `configOnly` files that load none (the config imports the changed
 * sequencer), all 10 s each, run one at a time.
 */
function shape(configOnly: number) {
  const loaders = ["test/leaf-a.test.ts", "test/leaf-b.test.ts"];
  const others = many("test/config", configOnly);
  const loads = Object.fromEntries([
    ...loaders.map((p) => [p, [LEAF, p]] as const),
    ...others.map((p) => [p, ["src/other.ts", p]] as const),
  ]);
  const picked = [pick("node-test", [...others, ...loaders], loads)];
  const order = orderRuns(picked, new Map(), { durations: () => 10, tierSize: 1 });
  return { order, loaders, others };
}

/** `order`'s fit at `leftSeconds` of a 600 s budget. */
const fitAt = (order: ReturnType<typeof shape>["order"], leftSeconds: number) =>
  fitOrder(order, 600, performance.now() + leftSeconds * 1000 + 500);

describe("orderRuns: the whole run's estimate", () => {
  it("adds the runners' estimates and counts the stored durations", () => {
    const picked = [
      pick("vitest", ["test/a.test.ts"], { "test/a.test.ts": [] }),
      pick("node-test", ["test/b.test.mjs", "test/c.test.mjs"], {}),
    ];
    const durations = (r: TestFileRef) => (r.path === "test/a.test.ts" ? 30 : 4);
    const order = orderRuns(picked, new Map(), { durations, tierSize: 1 });
    expect(order.whole).toEqual({ seconds: 30 + 8, known: 3 });
  });

  it("is unknown with no store", () => {
    const picked = [pick("vitest", ["test/a.test.ts"], {})];
    expect(orderRuns(picked, new Map(), { tierSize: 1 }).whole).toEqual({
      seconds: null,
      known: 0,
    });
  });
});

describe("fitOrder and budgetTold", () => {
  it("names a rerun whose --timeout fits the estimate when it is over what is left", async () => {
    const { order } = shape(EARLY_KNOWN);
    // 22 files of 10 s, one at a time: 220 s, over 200 s and under 400 s.
    const fit = fitAt(order, 200);
    expect(fit).toMatchObject({ leftSeconds: 200, seconds: 220, known: 22 });
    expect(fit.early).toBeUndefined();
    const runs = await inLoaderOrder(order.runs, { changed: [LEAF] });
    const told = budgetTold(fit, runs, defaultRerun("origin/main"));
    // 400 s spent before the first run, then 2 x 220 s: 840 s, a whole minute.
    expect(told.rerun).toEqual({
      seconds: 840,
      command: "squeal code --base origin/main --timeout 840",
    });
    expect(told.rerun?.seconds).toBeGreaterThanOrEqual(600 - 200 + 2 * 220);
    expect(told.early).toBeUndefined();
  });

  it("names nothing when the run fits", async () => {
    const { order } = shape(EARLY_KNOWN);
    const fit = fitAt(order, 300);
    const runs = await inLoaderOrder(order.runs, { changed: [LEAF] });
    expect(budgetTold(fit, runs, defaultRerun("main"))).toEqual({ fit });
  });
});

describe("inLoaderOrder with an early stop", () => {
  it("at twice what is left, runs the loaders and leaves the others out, by name", async () => {
    const { order, loaders, others } = shape(EARLY_KNOWN);
    const fit = fitAt(order, 110);
    expect(fit.early).toBe(true);
    const early = { functions: [LEAF], tests: [] };
    const runs = await inLoaderOrder(order.runs, { changed: [LEAF], early });
    expect(runs[0]?.files.map((r) => r.path)).toEqual(loaders);
    expect(runs[0]?.overBudget?.map((r) => r.path)).toEqual(others);
    const told = budgetTold(fit, runs, defaultRerun("main"));
    expect(told.early).toEqual({ run: 2, overBudget: others });
    // 490 s spent, then 2 x 220 s: 930 s, up to 960.
    expect(told.rerun?.seconds).toBe(960);
  });

  it("under twice what is left, leaves nothing out", async () => {
    const { order } = shape(EARLY_KNOWN);
    const fit = fitAt(order, 111);
    expect(fit.early).toBeUndefined();
    const runs = await inLoaderOrder(order.runs, { changed: [LEAF] });
    expect(runs[0]?.files).toHaveLength(EARLY_KNOWN + 2);
    expect(runs[0]?.overBudget).toBeUndefined();
  });

  it("runs a --test file and a file only declared inputs chose, though they load none", async () => {
    const loads = {
      "test/named.test.ts": ["src/other.ts"],
      "test/declared.test.ts": ["src/other.ts"],
      "test/config.test.ts": ["src/other.ts"],
      "test/leaf.test.ts": [LEAF],
    };
    const files = Object.keys(loads);
    const picked = [pick("vitest", files, loads, ["test/declared.test.ts"])];
    const order = orderRuns(picked, new Map(), { durations: () => 1, tierSize: 1 });
    const early = { functions: [LEAF], tests: ["test/named.test.ts" as RelativePath] };
    const runs = await inLoaderOrder(order.runs, { changed: [LEAF], early });
    expect(runs[0]?.files.map((r) => r.path)).toEqual([
      "test/leaf.test.ts",
      "test/named.test.ts",
      "test/declared.test.ts",
    ]);
    expect(runs[0]?.overBudget?.map((r) => r.path)).toEqual(["test/config.test.ts"]);
  });

  it("runs a file whose closure is unknown", async () => {
    const picked = [pick("vitest", ["test/unknown.test.ts"], {})];
    const order = orderRuns(picked, new Map(), { tierSize: 1 });
    const early = { functions: [LEAF], tests: [] };
    const runs = await inLoaderOrder(order.runs, { changed: [LEAF], early });
    expect(runs[0]?.files.map((r) => r.path)).toEqual(["test/unknown.test.ts"]);
    expect(runs[0]?.overBudget).toBeUndefined();
  });
});
