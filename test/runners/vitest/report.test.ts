import { describe, expect, it } from "vitest";
import type { CheckRunResult, TestFileRef } from "../../../src/core/types/index.js";
import { WorktreePaths } from "../../../src/runners/vitest/paths.js";
import { RunCollector } from "../../../src/runners/vitest/reporter.js";
import { refKey } from "../../../src/runners/vitest/results.js";
import { buildReport, type RunExecution } from "../../../src/runners/vitest/run.js";
import { ref } from "./helpers.js";

const ROOT = "/work/tree";
const completed: RunExecution = { end: "completed", failure: null, hung: false };

/** A collector as the reporter hooks leave it after two files passed. */
function collectorWithTwoPassedFiles(): RunCollector {
  const files = [ref("test/a.test.ts"), ref("test/b.test.ts")];
  const collector = new RunCollector(files, new WorktreePaths(ROOT));
  for (const file of files) {
    collector.modules.set(refKey(file), {
      ref: file,
      state: "passed",
      errors: [],
      afterCancel: false,
    });
    collector.results.push({ ref: file, result: passed(file) });
  }
  return collector;
}

function passed(file: TestFileRef): CheckRunResult {
  return {
    check: { kind: "test", project: file.project, testPath: file.path, fullName: "works" },
    outcome: "pass",
    durationMs: 1,
    location: null,
    errors: [],
  };
}

describe("vitest adapter: run report", () => {
  it("ends the run as crashed on an unhandled error Vitest cannot attribute (review S7)", () => {
    const collector = collectorWithTwoPassedFiles();
    collector.unhandledErrors.push({
      name: "Error",
      message: "orphan boom",
      stack: `Error: orphan boom\n    at ${ROOT}/src/leak.ts:3:9`,
    });
    const report = buildReport(collector, completed, 12);

    // Spec 001 D12: the run is untrusted, so nothing in it may be stored.
    expect(report.end).toBe("crashed");
    expect(report.failure).toBe(
      "unhandled error outside any test file: Error: orphan boom\n    at src/leak.ts:3:9",
    );
    expect(report.completedFiles).toEqual([]);
    expect(report.results).toEqual([]);
    expect(report.fileErrors).toEqual([]);
  });

  it("keeps the run trusted when every unhandled error names its test file", () => {
    const collector = collectorWithTwoPassedFiles();
    collector.unhandledErrors.push({
      name: "Error",
      message: "late boom",
      VITEST_TEST_PATH: `${ROOT}/test/b.test.ts`,
    });
    const report = buildReport(collector, completed, 12);

    expect(report.end).toBe("completed");
    expect(report.failure).toBeNull();
    expect(report.completedFiles).toEqual([ref("test/a.test.ts"), ref("test/b.test.ts")]);
    expect(report.fileErrors.map((e) => [e.testFile.path, e.errors[0]?.message])).toEqual([
      ["test/b.test.ts", "late boom"],
    ]);
  });

  it("reports nothing as completed when the run itself crashed", () => {
    const report = buildReport(
      collectorWithTwoPassedFiles(),
      { end: "crashed", failure: `Error: pool died at ${ROOT}/x`, hung: false },
      12,
    );
    expect(report.end).toBe("crashed");
    expect(report.failure).toBe("Error: pool died at x");
    expect(report.completedFiles).toEqual([]);
    expect(report.results).toEqual([]);
  });
});
