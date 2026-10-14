import { describe, expect, it } from "vitest";
import { recordsForFile } from "../../src/core/scheduler/records.js";
import { describeFailure } from "../../src/core/state/index.js";
import type {
  CheckId,
  CheckRunResult,
  FileCheckId,
  Provenance,
  RunReport,
  TestCheckId,
  TestFileRef,
} from "../../src/core/types/index.js";

/*
 * Spec 007 D6, task 007-23 (review wave 2, B3): a file listed in
 * `RunReport.skippedFiles` records `skip` for every check of its previous
 * key, the runner's static fallback only when the core knows none.
 */

const file: TestFileRef = { project: "small", path: "tests/test_param.py" };
const other: TestFileRef = { project: "small", path: "tests/test_other.py" };
const test = (fullName: string, ref = file): TestCheckId => ({
  kind: "test",
  project: ref.project,
  testPath: ref.path,
  fullName,
});
const fileCheck: FileCheckId = { kind: "file", project: file.project, testPath: file.path };
const provenance: Provenance = {
  worktreeId: "wt",
  revision: 2,
  commit: "abc",
  dirty: true,
  runId: "run-2",
  recordedAt: 100,
};
const staticSkip = (check: TestCheckId): CheckRunResult => ({
  check,
  outcome: "skip",
  durationMs: 0,
  location: { path: check.testPath, line: 3, column: 1 },
  errors: [],
});

/** A run whose module-level skip of `file` came with the adapter's static `test_param`. */
const skipped: RunReport = {
  end: "completed",
  durationMs: 10,
  completedFiles: [file, other],
  results: [staticSkip(test("test_param")), staticSkip(test("test_x", other))],
  fileErrors: [],
  failure: null,
  skippedFiles: [{ testFile: file, reason: "no service" }],
};

const records = (previousChecks: readonly CheckId[], report = skipped) =>
  recordsForFile({
    ref: file,
    key: "k2",
    report,
    previousChecks,
    provenance,
    describe: describeFailure,
  });

describe("recordsForFile of a skipped module (007-23)", () => {
  it("skips every check of the previous key, with no synthetic static check", () => {
    const known = [test("test_param[1]"), test("test_param[2]"), test("test_x", other), fileCheck];
    expect(records(known).map((r) => [r.check, r.outcome])).toEqual([
      [test("test_param[1]"), "skip"],
      [test("test_param[2]"), "skip"],
      [fileCheck, "pass"],
    ]);
    expect(records(known).every((r) => r.key === "k2" && r.provenance === provenance)).toBe(true);
  });

  it("keeps the runner's static skips for a file the core never saw", () => {
    expect(records([]).map((r) => [r.check, r.outcome])).toEqual([
      [test("test_param"), "skip"],
      [fileCheck, "pass"],
    ]);
    // Only the file-level check known: no test check to skip, so the fallback stands.
    expect(records([fileCheck]).map((r) => r.check)).toEqual([test("test_param"), fileCheck]);
  });

  it("leaves a file the report does not list as skipped as it was", () => {
    const { skippedFiles: _, ...plain } = skipped;
    expect(records([test("test_param[1]")], plain).map((r) => [r.check, r.outcome])).toEqual([
      [test("test_param"), "skip"],
      [fileCheck, "pass"],
    ]);
  });
});
