import { describe, expect, it } from "vitest";
import { type Range, unrun } from "./coverage.js";

/*
 * The coverage proof reads each process's V8 report on its own (review of
 * cand/0.1.228): a line ran when it ran in any process. Merged into one list,
 * a process that never called the function, or that skipped a branch V8
 * reports for it alone, outvoted the process where the line ran.
 */

const TEXT = ["function f(x) {", "  if (x) {", "    return 1;", "  }", "  return 2;", "}"].join(
  "\n",
);
const block = { start: TEXT.indexOf("{\n    return 1"), end: TEXT.indexOf("\n  return 2") };
const fn = (count: number): Range => ({ start: 0, end: TEXT.length, count });

// V8 drops a nested range whose count equals its parent's, so a taken branch has none.
const neverCalled: Range[] = [fn(0)];
const branchTaken: Range[] = [fn(1)];
const branchSkipped: Range[] = [fn(1), { ...block, count: 0 }];

describe("unrun, over one report per process", () => {
  it("counts a line that ran in one process beside one that never called its function", () => {
    expect(unrun(TEXT, [neverCalled, branchTaken], [3, 5])).toEqual([]);
    expect(unrun(TEXT, [branchTaken, neverCalled], [3, 5])).toEqual([]);
  });

  it("counts a branch taken in one process beside one that skipped it", () => {
    expect(unrun(TEXT, [branchSkipped, branchTaken], [3])).toEqual([]);
    expect(unrun(TEXT, [branchTaken, branchSkipped], [3])).toEqual([]);
  });

  it("names a line no process ran", () => {
    expect(unrun(TEXT, [neverCalled, branchSkipped], [3, 5])).toEqual([3]);
    expect(unrun(TEXT, [neverCalled], [3, 5])).toEqual([3, 5]);
    expect(unrun(TEXT, [], [3])).toEqual([3]);
  });
});
