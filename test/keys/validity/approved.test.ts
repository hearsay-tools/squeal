import { describe, expect, it } from "vitest";
import { APPROVED_RAISES } from "./approved.js";
import type { Comparison } from "./compare.js";
import { COMPONENTS } from "./components.js";
import { failures } from "./verdict.js";

/*
 * Review 0.1.388 S1: a recorded raise and an emptied format excuse a move of
 * `KEY_FORMAT_VERSION` only upward. A move down to a recorded format could
 * compute keys an earlier release stored, so it fails, and every component
 * stays held to its changed lines.
 */

const recorded = Math.max(...Object.keys(APPROVED_RAISES).map(Number));

function comparison(baseline: number, candidate: number): Comparison {
  return {
    installed: true,
    fired: true,
    readAsOne: [],
    cases: [],
    uncovered: ["changed-line-with-no-case"],
    alarms: COMPONENTS.map((component) => ({
      component,
      fired: true,
      dependencies: null,
      versions:
        component.name === "global"
          ? { baseline: String(baseline), candidate: String(candidate) }
          : { baseline: "1", candidate: "1" },
      uncovered: ["changed-line-with-no-case"],
    })),
  };
}

describe("a recorded format raise", () => {
  it("excuses an upward move to the recorded format", () => {
    expect(failures(comparison(recorded - 1, recorded), "squeal--v-test")).toEqual([]);
  });

  it("excuses no move down to a recorded format, and holds every other component to its changed lines", () => {
    const out = failures(comparison(recorded + 1, recorded), "squeal--v-test");
    expect(out[0]).toMatch(
      /^KEY_FORMAT_VERSION .* moved down from \d+ at squeal--v-test to \d+: a version only rises/,
    );
    // The format's own failure is the move down; each other component is held to its changed lines.
    expect(out.filter((line) => line.includes("changed lines no case runs"))).toHaveLength(
      COMPONENTS.length - 1,
    );
  });
});
