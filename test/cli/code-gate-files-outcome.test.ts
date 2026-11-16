import { describe, expect, it } from "vitest";
import { fileRun } from "../../src/cli/code-gate-files.js";
import type { TestFileEvidence } from "../../src/core/code/gate/types.js";
import type { RelativePath } from "../../src/core/types/common.js";

/*
 * Spec 023 D4.6 (row 023-04): each named file's outcome from the gate's
 * evidence: failed tests sorted by name, `not-run` with its reason.
 */

const file = (over: Partial<TestFileEvidence>): TestFileEvidence => ({
  runner: "vitest",
  path: "test/a.test.ts" as RelativePath,
  completed: true,
  failed: [],
  skipped: false,
  loads: null,
  record: null,
  ...over,
});

describe("fileRun: one named file's outcome (spec 023 D4.6, row 023-04)", () => {
  it("sorts the failed tests and keeps their errors; parts give names with no errors", () => {
    const error = { name: "Error", message: "boom", stack: null, location: null, diff: null };
    const run = fileRun(
      file({
        failed: ["b", "a"],
        failures: [
          { test: "b", errors: [error] },
          { test: "a", errors: [] },
        ],
      }),
    );
    expect(run).toMatchObject({ outcome: "failed", from: "run" });
    expect(run.failed).toEqual([
      { test: "a", errors: [] },
      { test: "b", errors: [error] },
    ]);

    const parts = fileRun(file({ failed: ["z", "y"], from: "parts" }));
    expect(parts.failed).toEqual([
      { test: "y", errors: [] },
      { test: "z", errors: [] },
    ]);
    expect(fileRun(file({ from: "store" }))).toMatchObject({ outcome: "passed", from: "store" });
  });

  it("tells a file never started from one stopped while it ran", () => {
    const unfinished = { completed: false };
    expect(fileRun(file({ ...unfinished, notStarted: true }))).toMatchObject({
      outcome: "not-run",
      reason: "budget",
    });
    expect(fileRun(file({ ...unfinished, overBudget: true }))).toMatchObject({ reason: "budget" });
    expect(fileRun(file({ ...unfinished, notPrepared: true }))).toMatchObject({
      outcome: "not-run",
      reason: "prepare",
    });
    expect(fileRun(file(unfinished))).toEqual({
      runner: "vitest",
      path: "test/a.test.ts",
      from: "run",
      skipped: false,
      outcome: "not-finished",
      failed: [],
    });
  });
});
