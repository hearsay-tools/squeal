import { describe, expect, it } from "vitest";
import {
  EARLY_KNOWN,
  estimateAll,
  estimateRun,
  fitBudget,
  median,
} from "../../../src/core/code/gate/estimate.js";

/*
 * Spec 020 D17.1 (row 020-17a): one runner's estimate before its first run.
 * Per parallel group, the larger of its longest file and its summed
 * durations over its width; a group one file wide runs one file at a time,
 * so it adds its sum. A file with no stored duration counts at the median
 * of those that have one; with none stored, the estimate is unknown.
 */

describe("estimateRun", () => {
  it("sums the durations over the width, in whole seconds", () => {
    const estimate = estimateRun("vitest", [{ width: 4, seconds: [10, 10, 10, 10, 10, 10] }]);
    expect(estimate).toEqual({ runner: "vitest", seconds: 15, files: 6, known: 6, width: 4 });
  });

  it("takes the longest file when it is longer than the share of the width", () => {
    expect(estimateRun("vitest", [{ width: 8, seconds: [90, 1, 1, 1] }]).seconds).toBe(90);
  });

  it("adds a sequential group's sum after a parallel group", () => {
    const estimate = estimateRun("vitest", [
      { width: 4, seconds: [8, 8, 8, 8] },
      { width: 1, seconds: [5, 7] },
    ]);
    expect(estimate).toEqual({ runner: "vitest", seconds: 8 + 12, files: 6, known: 6, width: 4 });
  });

  it("counts a file with no stored duration at the median of the others", () => {
    const estimate = estimateRun("node-test", [{ width: 2, seconds: [2, null, 4, 30, null] }]);
    // The median of 2, 4 and 30 is 4: (2 + 4 + 4 + 30 + 4) / 2 = 22, over the longest, 30.
    expect(estimate).toEqual({ runner: "node-test", seconds: 30, files: 5, known: 3, width: 2 });
    const wide = estimateRun("node-test", [{ width: 1, seconds: [2, null, 4, 30, null] }]);
    expect(wide.seconds).toBe(44);
  });

  it("is unknown with no stored duration, and still counts the files", () => {
    const estimate = estimateRun("vitest", [
      { width: 3, seconds: [null, null] },
      { width: 1, seconds: [null] },
    ]);
    expect(estimate).toEqual({ runner: "vitest", seconds: null, files: 3, known: 0, width: 3 });
  });

  it("rounds a fraction of a second up, so a short run never reads 0 s", () => {
    expect(estimateRun("vitest", [{ width: 4, seconds: [0.2, 0.3] }]).seconds).toBe(1);
  });
});

describe("median", () => {
  it("is the middle value, or the mean of the two middle ones", () => {
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});

/*
 * Rows 020-45 and 020-46 (#196, #198): the whole run's estimate against
 * what is left of the budget. Over it, a rerun `--timeout` fits: the
 * seconds spent before the first run plus twice the estimate, up to a
 * whole minute. At twice what is left, from enough stored durations, the
 * gate stops early.
 */

describe("estimateAll", () => {
  it("takes the larger runner's estimate, as the runners run at once (D18 as amended, row 020-44)", () => {
    const run = estimateAll([
      { runner: "vitest", groups: [{ width: 2, seconds: [10, 10, 10, 10] }] },
      { runner: "node-test", groups: [{ width: 1, seconds: [3, 4] }] },
    ]);
    // Vitest 20, node:test 7: the run takes the longer lane, not 27.
    expect(run).toEqual({ seconds: 20, known: 6 });
    const longer = estimateAll([
      { runner: "vitest", groups: [{ width: 2, seconds: [1, 1] }] },
      { runner: "node-test", groups: [{ width: 1, seconds: [30, 4] }] },
    ]);
    expect(longer).toEqual({ seconds: 34, known: 4 });
  });

  it("counts a runner with no stored duration at every runner's median (D18.2)", () => {
    const run = estimateAll([
      { runner: "vitest", groups: [{ width: 1, seconds: [2, 4, 6] }] },
      { runner: "node-test", groups: [{ width: 1, seconds: [null, null, null, null, null] }] },
    ]);
    // Vitest 12; node:test five files at the median 4, one at a time: 20, the longer lane.
    expect(run).toEqual({ seconds: 20, known: 3 });
  });

  it("is unknown with no stored duration at all", () => {
    const run = estimateAll([{ runner: "vitest", groups: [{ width: 4, seconds: [null, null] }] }]);
    expect(run).toEqual({ seconds: null, known: 0 });
  });
});

describe("fitBudget", () => {
  const budget = { budgetSeconds: 600, leftSeconds: 590 };

  it("names no rerun when the run fits what is left", () => {
    expect(fitBudget({ seconds: 590, known: 40 }, budget)).toEqual({
      leftSeconds: 590,
      seconds: 590,
      known: 40,
    });
  });

  it("names no rerun when the time is unknown", () => {
    expect(fitBudget({ seconds: null, known: 0 }, budget)).toEqual({
      leftSeconds: 590,
      seconds: null,
      known: 0,
    });
  });

  it("over what is left, fits a rerun --timeout to twice the estimate after the time spent", () => {
    const fit = fitBudget({ seconds: 700, known: 40 }, budget);
    // 10 s spent before the first run, then 2 x 700 s: 1410 s, up to 1440.
    expect(fit).toEqual({ leftSeconds: 590, seconds: 700, known: 40, rerunSeconds: 1440 });
    expect(fit.rerunSeconds).toBeGreaterThanOrEqual(10 + 2 * 700);
  });

  it("keeps a whole minute as it is", () => {
    const fit = fitBudget({ seconds: 145, known: 1 }, { budgetSeconds: 100, leftSeconds: 90 });
    expect(fit.rerunSeconds).toBe(300);
  });

  it("stops early at twice what is left, from enough stored durations", () => {
    const twice = fitBudget({ seconds: 1180, known: EARLY_KNOWN }, budget);
    expect(twice).toMatchObject({ rerunSeconds: 2400, early: true });
    const under = fitBudget({ seconds: 1179, known: 400 }, budget);
    expect(under.rerunSeconds).toBe(2400);
    expect(under.early).toBeUndefined();
  });

  it("does not stop early when fewer files than EARLY_KNOWN have a stored duration", () => {
    const few = fitBudget({ seconds: 5000, known: EARLY_KNOWN - 1 }, budget);
    expect(few.rerunSeconds).toBe(10020);
    expect(few.early).toBeUndefined();
  });
});
