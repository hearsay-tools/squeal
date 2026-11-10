import { describe, expect, it } from "vitest";
import { type CostOfPart, costOf, costText } from "../../src/core/ci/cost.js";
import type { RecordingCost } from "../../src/core/ci/parts.js";

/*
 * Row 018-29 (spec 018 D8): each recording states what Squeal's hooks took.
 * Parts of one command hold the same cost, so a reader counts it once; the
 * test time is the parts' test files' durations summed.
 */

const cost = (command: string, hooksMs: number, threads: number, afterMs: number) =>
  ({ command, hooksMs, threads, afterMs }) satisfies RecordingCost;

const part = (durations: readonly (number | null)[], spent?: RecordingCost): CostOfPart => ({
  header: spent === undefined ? {} : { cost: spent },
  testFiles: durations.map((durationMs) => ({ durationMs })),
});

describe("costOf", () => {
  it("counts each command once over its parts, and every part's test time", () => {
    const one = cost("one", 300, 5, 40);
    const two = cost("two", 100, 3, 60);
    const summary = costOf([part([1000, 2000], one), part([500, null], one), part([500], two)]);
    expect(summary).toEqual({
      commands: 2,
      hooksMs: 400,
      threads: 8,
      afterMs: 100,
      testMs: 4000,
      without: 0,
      parts: 3,
    });
  });

  it("is null when no part holds a cost (an older Squeal made them)", () => {
    expect(costOf([part([1000]), part([])])).toBeNull();
    expect(costOf([])).toBeNull();
  });
});

describe("costText", () => {
  it("names the time, the processes, the share of the test time and the time after the command", () => {
    const summary = costOf([part([10_000, 30_000], cost("c", 1240, 9, 420))]);
    expect(summary && costText(summary)).toBe(
      "Squeal's recording took 1.24 s in 9 processes and threads, 3.1% of the test time (40.0 s); 0.42 s more after the command",
    );
  });

  it("counts several commands, names parts without a cost, and says when no test time was recorded", () => {
    const summary = costOf([
      part([], cost("a", 12_345, 1, 0)),
      part([], cost("b", 0, 0, 5)),
      part([60_000]),
    ]);
    expect(summary && costText(summary)).toBe(
      "Squeal's recording took 12.3 s in 1 process or thread of 2 commands, no test time recorded; 0.01 s more after the commands; 1 of 3 parts hold no cost (an older Squeal made them)",
    );
  });
});
