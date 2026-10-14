import { loadavg } from "node:os";
import type { SerializedError, TestCase, TestModule } from "vitest/node";
import { compare } from "../../core/fs/index.js";
import { cap } from "../../core/text.js";
import type {
  CheckError,
  CheckErrorCause,
  CheckRunResult,
  EnumeratedCheck,
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
  const code = codeOf(error);
  const causes = causeChain(error.cause, paths);
  return {
    name: error.name ?? "Error",
    message: paths.relativizeText(error.message ?? ""),
    stack: error.stack ? paths.relativizeText(error.stack) : null,
    location: frame ? paths.location(frame.file, frame.line, frame.column) : null,
    diff: diff === null ? null : paths.relativizeText(diff),
    ...(code === undefined ? {} : { code }),
    ...(causes.length === 0 ? {} : { causes }),
  };
}

/** Links of a cause chain kept, outermost first (task 001-361). */
export const CAUSE_DEPTH = 3;

/** Characters a cause's message keeps; its code is kept whole. */
export const CAUSE_MESSAGE_CHARS = 200;

/** A Node error code (`ECONNREFUSED`), or a numeric one as text. */
function codeOf(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  const code = error.code;
  return typeof code === "string" || typeof code === "number" ? String(code) : undefined;
}

/**
 * Task 001-361, research environment-failures Q1: undici's "fetch failed"
 * names the refused connection only in its `cause`. Each link keeps its
 * message's first line, capped and relativized, and its code. A cause that is
 * not an error (`{ cause: "text" }`) is its text.
 */
function causeChain(cause: unknown, paths: WorktreePaths): CheckErrorCause[] {
  const chain: CheckErrorCause[] = [];
  for (let link = cause; link != null && chain.length < CAUSE_DEPTH; ) {
    const object = typeof link === "object" ? link : null;
    const raw = object === null ? link : "message" in object ? object.message : "";
    const line = paths.relativizeText(String(raw ?? "")).split(/\r?\n/)[0] ?? "";
    const code = codeOf(link);
    chain.push({ message: cap(line.trim(), CAUSE_MESSAGE_CHARS), ...(code ? { code } : {}) });
    link = object !== null && "cause" in object ? object.cause : undefined;
  }
  return chain;
}

/** Vitest's message for a test or hook that ran past its timeout. */
const TIMEOUT = /^(?:Test|Hook) timed out in \d+ms/;

/** The one-minute load average; `null` on Windows, where Node reports 0. */
const currentLoad = () => (process.platform === "win32" ? null : (loadavg()[0] ?? null));

/**
 * Task 001-91, lessons defect 16: a timeout under load reads like a broken
 * test, so a timed-out test's error carries the load average as its result
 * comes in (`onTestCaseResult`). Every other error is returned as it is.
 */
export function withLoad(error: CheckError, load: () => number | null = currentLoad): CheckError {
  if (!TIMEOUT.test(error.message)) return error;
  const value = load();
  return value === null ? error : { ...error, loadAverage: value };
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

/** The checks of one parsed test module, named by `checkNames`. */
export function enumeratedChecks(module: TestModule, testFile: TestFileRef): EnumeratedCheck[] {
  const names = checkNames(module.children.allTests());
  return [...module.children.allTests()].map((test) => ({
    check: {
      kind: "test",
      project: testFile.project,
      testPath: testFile.path,
      fullName: names.get(test.id) ?? test.fullName,
    },
    // Research Q2: `test.each` parses to one entry with a `-dynamic` id.
    templated: test.options.each === true || test.id.endsWith("-dynamic"),
    location: test.location
      ? { path: testFile.path, line: test.location.line, column: test.location.column }
      : null,
  }));
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
    errors:
      outcome === "fail" ? (result.errors ?? []).map((e) => withLoad(toCheckError(e, paths))) : [],
  };
}

export const refKey = (ref: TestFileRef) => `${ref.project}\0${ref.path}`;

export function compareRefs(a: TestFileRef, b: TestFileRef): number {
  return a.project === b.project ? compare(a.path, b.path) : compare(a.project, b.project);
}
