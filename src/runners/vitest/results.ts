import type { SerializedError, TestCase } from "vitest/node";
import type {
  CheckError,
  CheckRunResult,
  RunOutcome,
  TestFileRef,
} from "../../core/types/index.js";
import type { WorktreePaths } from "./paths.js";

/** Vitest test states mapped to run outcomes. `pending` means the test did not run: no result. */
const OUTCOMES: Record<string, RunOutcome | undefined> = {
  passed: "pass",
  failed: "fail",
  skipped: "skip",
};

/** Research Q4: "Failure location: `errors[0].stacks[0]`", narrowed to the first project frame. */
export function toCheckError(error: SerializedError, paths: WorktreePaths): CheckError {
  const frame = error.stacks?.find((f) => paths.isProjectFile(f.file));
  const diff = typeof error.diff === "string" ? error.diff : null;
  return {
    name: error.name ?? "Error",
    message: paths.relativizeText(error.message ?? ""),
    stack: error.stack ? paths.relativizeText(error.stack) : null,
    location: frame ? paths.location(frame.file, frame.line, frame.column) : null,
    diff: diff === null ? null : paths.relativizeText(diff),
  };
}

export function toCheckRunResult(
  testCase: TestCase,
  testFile: TestFileRef,
  paths: WorktreePaths,
): CheckRunResult | null {
  const result = testCase.result();
  const outcome = OUTCOMES[result.state];
  if (!outcome) return null;
  const location = testCase.location;
  return {
    check: {
      kind: "test",
      project: testFile.project,
      testPath: testFile.path,
      fullName: testCase.fullName,
    },
    outcome,
    durationMs: testCase.diagnostic()?.duration ?? 0,
    location: location
      ? { path: testFile.path, line: location.line, column: location.column }
      : null,
    errors: outcome === "fail" ? (result.errors ?? []).map((e) => toCheckError(e, paths)) : [],
  };
}

export const refKey = (ref: TestFileRef) => `${ref.project}\0${ref.path}`;

export function compareRefs(a: TestFileRef, b: TestFileRef): number {
  return a.project === b.project ? compare(a.path, b.path) : compare(a.project, b.project);
}

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
