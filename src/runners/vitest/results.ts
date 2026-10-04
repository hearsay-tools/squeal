import type { SerializedError, TestCase } from "vitest/node";
import { compare } from "../../core/fs/index.js";
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

/**
 * Check names of one module's tests, by test id, in declaration order.
 *
 * Spec 001 D4: "When two tests in one file share a `fullName`, the second and
 * later ones carry their source line as a suffix." Duplicates on one line
 * (`test.each` with equal names) add an ordinal: `name (line 5, 2)`.
 */
export function checkNames(tests: Iterable<TestCase>): Map<string, string> {
  const names = new Map<string, string>();
  const used = new Set<string>();
  for (const test of tests) {
    let name = test.fullName;
    if (used.has(name)) {
      const line = test.location ? `line ${test.location.line}` : "line ?";
      name = `${test.fullName} (${line})`;
      for (let n = 2; used.has(name); n++) name = `${test.fullName} (${line}, ${n})`;
    }
    used.add(name);
    names.set(test.id, name);
  }
  return names;
}

/** `fullName` is the check name from `checkNames`. */
export function toCheckRunResult(
  testCase: TestCase,
  testFile: TestFileRef,
  paths: WorktreePaths,
  fullName: string,
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
      fullName,
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
