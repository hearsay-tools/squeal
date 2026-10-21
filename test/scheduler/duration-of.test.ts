import { describe, expect, it } from "vitest";
import { durationOf } from "../../src/core/scheduler/files.js";
import type { CheckId, ResultRecord } from "../../src/core/types/index.js";

const PATH = "test/a.test.ts";
const fileLevel: CheckId = { kind: "file", project: "", testPath: PATH };
const test = (fullName: string): CheckId => ({
  kind: "test",
  project: "",
  testPath: PATH,
  fullName,
});

function timed(check: CheckId, durationMs: number): ResultRecord {
  return {
    check,
    key: "k1",
    outcome: "pass",
    durationMs,
    location: null,
    fingerprint: null,
    summary: null,
    errors: [],
    provenance: {
      worktreeId: "wt",
      revision: 1,
      commit: "abc",
      dirty: false,
      runId: "run-1",
      recordedAt: 1,
    },
  };
}

/*
 * Row 013-03 (gh-62): the file-level check holds the whole file's time, so a
 * file's duration is that check's, not the sum of its results; a result an
 * older daemon stored holds only the time outside its tests, so the file
 * reads at least the sum of its tests.
 */
describe("durationOf (013-03)", () => {
  it("is the file-level check's time when it holds the whole file", () => {
    expect(
      durationOf([timed(test("a"), 400), timed(test("b"), 400), timed(fileLevel, 1_650)]),
    ).toBe(1_650);
  });

  it("is the sum of the tests when the file-level check holds only the time outside them", () => {
    expect(
      durationOf([timed(test("a"), 54_400), timed(test("b"), 54_400), timed(fileLevel, 3_500)]),
    ).toBe(108_800);
  });

  it("is the sum of the tests of a file without a file-level result", () => {
    expect(durationOf([timed(test("a"), 2), timed(test("b"), 3)])).toBe(5);
  });

  it("is null without results", () => {
    expect(durationOf([])).toBeNull();
  });
});
