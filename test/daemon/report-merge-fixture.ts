import type { Part } from "../../src/core/daemon/report-merge.js";
import type { CheckError } from "../../src/core/types/check.js";
import type { TestFileRef } from "../../src/core/types/keys.js";
import type { CheckRunResult, RunReport, StartupFailure } from "../../src/core/types/runner.js";

/* The report merge's table (`report-merge.test.ts`): test files and one value of each field's type. */

export const A: TestFileRef = { project: "unit", path: "src/a.test.ts" };
export const B: TestFileRef = { project: "unit", path: "src/b.test.ts" };
export const C: TestFileRef = { project: "node", path: "test/c.test.ts" };

/** A part's report with no file, and the merged report of such parts. */
export const EMPTY: RunReport = {
  end: "completed",
  durationMs: 0,
  completedFiles: [],
  results: [],
  fileErrors: [],
  failure: null,
};

const NAMES = ["vitest", "node-test", "pytest"];

const error = (message: string): CheckError => ({
  name: "Error",
  message,
  stack: null,
  location: null,
  diff: null,
});

export const result = (testFile: TestFileRef): CheckRunResult => ({
  check: { kind: "test", project: testFile.project, testPath: testFile.path, fullName: "works" },
  outcome: "pass",
  durationMs: 1,
  location: null,
  errors: [],
});

export const fileError = (testFile: TestFileRef) => ({ testFile, errors: [error(testFile.path)] });
export const duration = (testFile: TestFileRef) => ({ testFile, durationMs: 5 });
export const seen = (testFile: TestFileRef) => ({ testFile, paths: ["src/x.ts"], directories: [] });
export const env = (project: string) => ({ project, paths: [`${project}/preload.mjs`] });
export const skip = (testFile: TestFileRef) => ({ testFile, reason: "no service" });
export const focus = (testFile: TestFileRef, matched: number) => ({
  testFile,
  collected: 3,
  matched,
});

export function setupFailure(project: string, testFiles: readonly TestFileRef[]): StartupFailure {
  return {
    projects: [project],
    testFiles,
    setupFile: `${project}/setup.ts`,
    error: { ...error(`setup ${project} failed`), phase: "setup" },
  };
}

/** Each part's fields over an empty report, named by its place. */
export function parts(fields: readonly Partial<RunReport>[]): Part[] {
  return fields.map((report, i) => ({
    adapter: { name: NAMES[i] ?? "runner" },
    report: { ...EMPTY, ...report },
  }));
}
