import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STEP_BUDGET_MS, StepCache } from "../../../src/core/code/crap/index.js";
import { COVERAGE_COALESCE_MS } from "../../../src/core/code/pass/index.js";
import type { Store } from "../../../src/core/types/index.js";
import { WT } from "../../state/helpers.js";
import { daemonPass } from "../pass/helpers.js";
import { COVERED, coverageRig, sourceOf } from "./rig.js";

/*
 * Row 015-42 (011-197's recommendation 2): a chain of coverage steps keeps
 * its loader map while keys and results stay, counts the map's read in the
 * step's budget, and starts each step no sooner than the step before took.
 */

/** How long the main store's listing of the worktree's test file keys takes, by the clock. */
const READ_MS = 300;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setImmediate", "Date"], now: 1_000 });
});

afterEach(() => {
  vi.useRealTimers();
});

/**
 * Two sources and one test file that loads both, with its record; the
 * pass's loader map is read through `lists`, and each read takes `READ_MS`.
 */
async function chain() {
  const rig = coverageRig();
  rig.tree.write("src/a.ts", "hot 12 h1\ncold 6 c1\n").write("src/b.ts", "one 2 o1\n").revise();
  const keys = rig.main.testFileKeys;
  let lists = 0;
  let steps = 0;
  const main = {
    results: rig.main.results,
    testFileKeys: {
      list: (...args: Parameters<Store["testFileKeys"]["list"]>) => {
        lists++;
        vi.setSystemTime(Date.now() + READ_MS);
        return keys.list(...args);
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
        steps++;
        return false;
      },
    },
  });
  run.code.nudge();
  await run.code.idle();
  // The first step's own time passes, so it paces none of the test's steps.
  await vi.advanceTimersByTimeAsync(10 * READ_MS);
  await run.code.idle();
  const blob = (path: string) => rig.store.files.list(WT, [path])[0]?.blob ?? "";
  rig.loader("test/a.test.ts", {
    closure: ["src/a.ts", "src/b.ts"],
    record: [
      sourceOf("src/a.ts", blob("src/a.ts"), 2, [1]),
      sourceOf("src/b.ts", blob("src/b.ts"), 1, [1]),
    ],
  });
  lists = 0;
  steps = 0;
  return { rig, run, lists: () => lists, steps: () => steps };
}

describe("a chain of coverage steps (row 015-42)", () => {
  it("reads the loader map once while keys and results stay, and again after either changes", async () => {
    const { rig, run, lists, steps } = await chain();
    run.code.soon();
    await vi.advanceTimersByTimeAsync(COVERAGE_COALESCE_MS + 10 * READ_MS);
    await run.code.idle();
    // The read spent the first step's budget, so the chain took a second step, with the same map.
    expect(steps()).toBe(2);
    expect(lists()).toBe(1);
    expect(rig.states("crap")).toEqual(["cold fail 42", "hot pass 12", "one pass 2"]);

    // Results were stored.
    run.code.soon();
    await vi.advanceTimersByTimeAsync(COVERAGE_COALESCE_MS + 10 * READ_MS);
    await run.code.idle();
    expect(lists()).toBe(2);

    // A revision moves keys.
    rig.tree.write("src/b.ts", "one 2 o2\n").revise();
    run.code.nudge();
    await vi.advanceTimersByTimeAsync(10 * READ_MS);
    await run.code.idle();
    expect(lists()).toBe(3);
    await run.code.close();
  });

  it("starts a step's successor no sooner than the step took", async () => {
    const { run, steps } = await chain();
    run.code.soon();
    await vi.advanceTimersByTimeAsync(COVERAGE_COALESCE_MS);
    expect(steps()).toBe(1);
    // The first step took READ_MS by the clock: the rest waits as long.
    await vi.advanceTimersByTimeAsync(READ_MS - 1);
    expect(steps()).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(steps()).toBe(2);

    // Results stored right after a step that took READ_MS: the next step waits it out too.
    run.code.soon();
    await vi.advanceTimersByTimeAsync(COVERAGE_COALESCE_MS);
    expect(steps()).toBe(3);
    run.code.soon();
    await vi.advanceTimersByTimeAsync(READ_MS - 1);
    expect(steps()).toBe(3);
    await vi.advanceTimersByTimeAsync(1);
    expect(steps()).toBe(4);
    await run.code.close();
  });

  it("decodes each record once over a chain, each decode inside the step's budget", async () => {
    const rig = coverageRig();
    await rig.edit({ "src/a.ts": "hot 12 h1\ncold 6 c1\n", "src/b.ts": "one 2 o1\n" });
    const blob = (path: string) => rig.store.files.list(WT, [path])[0]?.blob ?? "";
    const record = [
      sourceOf("src/a.ts", blob("src/a.ts"), 2, [1]),
      sourceOf("src/b.ts", blob("src/b.ts"), 1, [1]),
    ];
    const tests = ["test/a.test.ts", "test/b.test.ts", "test/c.test.ts"];
    for (const path of tests) rig.loader(path, { closure: ["src/a.ts", "src/b.ts"], record });
    const gets: string[] = [];
    const coverage = rig.store.coverage;
    const store = {
      ...rig.store,
      coverage: {
        ...coverage,
        get: (...args: Parameters<typeof coverage.get>) => {
          gets.push(args[0].resultKey);
          return coverage.get(...args);
        },
      },
    };
    // Each record's decode takes the budget.
    let clock = rig.clock;
    const now = () => clock;
    const cache = new StepCache();
    const steps: number[] = [];
    for (let i = 0; i < 10; i++) {
      const before = gets.length;
      const step = rig.step({
        store: {
          ...store,
          coverage: {
            ...store.coverage,
            get: (...args) => {
              clock += STEP_BUDGET_MS + 1;
              return store.coverage.get(...args);
            },
          },
        },
        now,
        cache,
      });
      steps.push(gets.length - before);
      if (step?.more !== true) break;
    }
    expect(steps).toEqual([1, 1, 1, 0]);
    expect(gets.sort()).toEqual(tests.map((path) => `key-${path}`));
    expect(rig.states("crap")).toEqual(["cold fail 42", "hot pass 12", "one pass 2"]);
  });
});
