import { describe, expect, it } from "vitest";
import { estimateRun, median } from "../../../src/core/code/gate/estimate.js";

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
