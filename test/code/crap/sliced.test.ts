import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STEP_BUDGET_MS } from "../../../src/core/code/crap/index.js";
import type { Store } from "../../../src/core/types/index.js";
import { WT } from "../../state/helpers.js";
import { daemonPass } from "../pass/helpers.js";
import { COVERED, coverageRig, sourceOf } from "./rig.js";

/*
 * Row 015-45 (review 0.1.305 S1): the coverage step reads the loader map a
 * test file at a time within its budget, the result lookups and the closure
 * walk included, and judges no source from part of it.
 */

/** How long one test file's result lookup takes, by the clock. */
const ROW_MS = 20;
const LOADERS = 9;
/** The rows a step reads: its first, and each next one while the step is within its budget. */
const ROWS_PER_STEP = Math.floor(STEP_BUDGET_MS / ROW_MS) + 1;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setImmediate", "Date"], now: 1_000 });
});

afterEach(() => {
  vi.useRealTimers();
});

/**
 * One source and `LOADERS` test files that load it, each with a record;
 * each result lookup of the pass takes `ROW_MS`. Each step's start records
 * the rows read so far and the source's CRAP states.
 */
async function sliced() {
  const rig = coverageRig();
  rig.tree.write("src/a.ts", "hot 12 h1\ncold 6 c1\n").revise();
  const reads: number[] = [];
  const seen: { readonly read: number; readonly states: readonly string[] }[] = [];
  const results = rig.main.results;
  const main = {
    testFileKeys: rig.main.testFileKeys,
    results: {
      byKey: (...args: Parameters<Store["results"]["byKey"]>) => {
        reads[reads.length - 1] = (reads.at(-1) ?? 0) + 1;
        vi.setSystemTime(Date.now() + ROW_MS);
        return results.byKey(...args);
      },
    },
  } as unknown as Pick<Store, "results" | "testFileKeys">;
  const run = daemonPass(rig.tree, {
    policy: () => COVERED,
    now: Date.now,
    coverage: {
      main,
      closures: () => rig.closures,
      writing: () => {
        seen.push({ read: reads.reduce((a, b) => a + b, 0), states: rig.states("crap") });
        reads.push(0);
        return false;
      },
    },
  });
  run.code.nudge();
  await run.code.idle();
  await vi.advanceTimersByTimeAsync(10 * STEP_BUDGET_MS);
  const blob = rig.store.files.list(WT, ["src/a.ts"])[0]?.blob ?? "";
  const loader = (t: number, ran: number[]) =>
    rig.loader(`test/t${t}.test.ts`, {
      closure: ["src/a.ts"],
      record: [sourceOf("src/a.ts", blob, 2, ran)],
    });
  for (let t = 0; t < LOADERS; t++) loader(t, [1]);
  reads.length = 0;
  seen.length = 0;
  return { rig, run, reads, seen, loader };
}

describe("the loader map in slices (row 015-45)", () => {
  it("reads it over several steps within their budget and judges once it is whole", async () => {
    const { rig, run, reads, seen } = await sliced();
    run.code.soon();
    await vi.advanceTimersByTimeAsync(100 * STEP_BUDGET_MS);
    await run.code.idle();

    expect(reads.length).toBeGreaterThan(Math.ceil(LOADERS / ROWS_PER_STEP));
    for (const read of reads) expect(read).toBeLessThanOrEqual(ROWS_PER_STEP);
    expect(reads.reduce((a, b) => a + b, 0)).toBe(LOADERS);
    // No step judged from part of the map: until every row was read, the states stay seeded.
    for (const at of seen.filter((s) => s.read < LOADERS)) {
      expect(at.states).toEqual(["cold pending -", "hot pending -"]);
    }
    expect(rig.states("crap")).toEqual(["cold fail 42", "hot pass 12"]);
    await run.code.close();
  });

  it("starts the map again when results come during its read", async () => {
    const { rig, run, reads, loader } = await sliced();
    run.code.soon();
    // The first step reads part of the map; then a new loader that ran `cold` gets its result.
    await vi.advanceTimersByTimeAsync(100);
    expect(reads.reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
    expect(reads.reduce((a, b) => a + b, 0)).toBeLessThan(LOADERS);
    loader(LOADERS, [1, 2]);
    run.code.soon();
    await vi.advanceTimersByTimeAsync(100 * STEP_BUDGET_MS);
    await run.code.idle();

    expect(rig.states("crap")).toEqual(["cold pass 6", "hot pass 12"]);
    await run.code.close();
  });
});
