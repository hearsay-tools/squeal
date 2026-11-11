import { describe, expect, it } from "vitest";
import type { EstimateGroup } from "../../../src/core/code/gate/estimate.js";
import { type RunnerFiles, runnerOrder } from "../../../src/core/code/gate/runner-order.js";

/*
 * Spec 020 D18.2 (row 020-19, #187): the runners run in ascending order of
 * their D17.1 estimate. A runner with no stored duration counts its files
 * at the median of every runner's stored ones; with none stored anywhere,
 * the runner with fewer files runs first. Ties keep the order given, which
 * is today's: Vitest, then node:test.
 */

const vitest = (...groups: EstimateGroup[]): RunnerFiles => ({ runner: "vitest", groups });
const node = (...groups: EstimateGroup[]): RunnerFiles => ({ runner: "node-test", groups });

describe("runnerOrder", () => {
  it("runs the runner with the smaller estimate first", () => {
    // Vitest: 40 files of 30 s, 4 at once, 300 s; node:test: 2 files of 1 s, 2 at once, 1 s.
    const runners = [
      vitest({ width: 4, seconds: Array(40).fill(30) }),
      node({ width: 2, seconds: [1, 1] }),
    ];
    expect(runnerOrder(runners)).toEqual(["node-test", "vitest"]);
  });

  it("reads the estimate, not the file count: more files at once can take less time", () => {
    // Vitest: 20 files of 1 s, 20 at once, 1 s; node:test: 3 files of 5 s, 1 at a time, 15 s.
    const runners = [
      vitest({ width: 20, seconds: Array(20).fill(1) }),
      node({ width: 1, seconds: [5, 5, 5] }),
    ];
    expect(runnerOrder(runners)).toEqual(["vitest", "node-test"]);
  });

  it("keeps the order given when the estimates tie", () => {
    const runners = [vitest({ width: 1, seconds: [3] }), node({ width: 1, seconds: [1, 2] })];
    expect(runnerOrder(runners)).toEqual(["vitest", "node-test"]);
    expect(runnerOrder([...runners].reverse())).toEqual(["node-test", "vitest"]);
  });

  it("counts a runner with no stored duration at the median of every runner's", () => {
    // Stored: 2, 4 and 10, median 4. Vitest's 3 files, 1 at a time: 12 s; node:test's 16 s.
    const runners = [
      vitest({ width: 1, seconds: [null, null, null] }),
      node({ width: 1, seconds: [2, 4, 10] }),
    ];
    expect(runnerOrder(runners)).toEqual(["vitest", "node-test"]);
    // With 5 files Vitest's 20 s is the longer.
    const more = [vitest({ width: 1, seconds: Array(5).fill(null) }), runners[1] as RunnerFiles];
    expect(runnerOrder(more)).toEqual(["node-test", "vitest"]);
  });

  it("keeps a runner's own estimate when some of its files have a stored duration", () => {
    // Vitest: 1 and the others at its own median 1, 3 s; node:test 50 s. At the median of every
    // runner's, 25.5, Vitest would take 52 s and run second.
    const runners = [
      vitest({ width: 1, seconds: [1, null, null] }),
      node({ width: 1, seconds: [50] }),
    ];
    expect(runnerOrder(runners)).toEqual(["vitest", "node-test"]);
  });

  it("runs the runner with fewer files first when no file has a stored duration", () => {
    const runners = [
      vitest({ width: 8, seconds: [null, null, null] }),
      node({ width: 1, seconds: [null] }),
    ];
    expect(runnerOrder(runners)).toEqual(["node-test", "vitest"]);
    const tie = [vitest({ width: 8, seconds: [null] }), node({ width: 1, seconds: [null] })];
    expect(runnerOrder(tie)).toEqual(["vitest", "node-test"]);
  });

  it("puts a runner with no file to run first", () => {
    expect(runnerOrder([vitest({ width: 1, seconds: [1] }), node()])).toEqual([
      "node-test",
      "vitest",
    ]);
    expect(runnerOrder([vitest(), node({ width: 1, seconds: [null] })])).toEqual([
      "vitest",
      "node-test",
    ]);
  });
});
