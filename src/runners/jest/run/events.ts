import { readFileSync, statSync } from "node:fs";

/**
 * The records `squeal-reporter.cjs` writes, one JSON line each (spec 028
 * D5.1). Paths are absolute, as Jest names the test file.
 */
export type JestEvent = FileStartEvent | CaseEvent | FileResultEvent | RunCompleteEvent;

export interface FileStartEvent {
  readonly type: "fileStart";
  readonly testFilePath: string;
}

/** What an error of a failed case or a file carries (`detail` in the reporter). */
export interface JestErrorDetail {
  readonly name?: string | null;
  readonly message?: string | null;
  readonly stack?: string | null;
  readonly code?: string | null;
  /** The error holds a matcher result: Jest's `expect` failed. */
  readonly matcher?: boolean;
}

/** One test case as Jest's `AssertionResult` gives it. */
export interface JestCase {
  readonly title: string;
  readonly ancestorTitles: readonly string[];
  readonly fullName: string;
  /** `passed`, `failed`, `pending` (`test.skip`), `todo`, `skipped`, `disabled` or `focused`. */
  readonly status: string;
  /** Milliseconds; `null` for a case that did not run. */
  readonly duration: number | null;
  /** From `--testLocationInResults`: one-based line and column. */
  readonly location: { readonly line: number; readonly column: number } | null;
  readonly failureMessages: readonly string[];
  readonly failureDetails: readonly JestErrorDetail[];
}

/** Streamed as a case ends; skipped and todo cases have none (research 028-01 F4.2). */
export interface CaseEvent extends JestCase {
  readonly type: "case";
  readonly testFilePath: string;
}

/** Jest's snapshot summary of one file. */
export interface JestSnapshot {
  readonly added: number;
  readonly fileDeleted: boolean;
  readonly matched: number;
  /** Obsolete entries: in the snapshot file, checked by no test. */
  readonly unchecked: number;
  readonly uncheckedKeys: readonly string[];
  readonly unmatched: number;
  readonly updated: number;
}

/** A test file's end: the only record that completes a file (Kit K8). */
export interface FileResultEvent {
  readonly type: "fileResult";
  readonly testFilePath: string;
  readonly durationMs: number | null;
  /** Every case of the file in declaration order, skipped and todo ones too. */
  readonly testResults: readonly JestCase[];
  /** A file that failed to run: a syntax error, a throw at load, a missing environment. */
  readonly testExecError: JestErrorDetail | null;
  readonly failureMessage: string | null;
  readonly snapshot: JestSnapshot;
  /** Absolute paths `observe-runtime.cjs` saw the file load; `[]` without it. */
  readonly loaded: readonly string[];
  /**
   * Row 028-08: absolute paths Jest's transform and resolver read with success
   * for the file, while `recorder.cjs` saw none of their probes; absent from
   * an older reporter.
   */
  readonly reads?: readonly string[];
  /** Spec 028 D5.3: the file's V8 payload, written before this line; absent without coverage. */
  readonly coverageFile?: string;
  /** With `coverageFile`: what Jest's transform ran of each script, by absolute path. */
  readonly transformSources?: string;
}

export interface RunCompleteEvent {
  readonly type: "runComplete";
  readonly success: boolean;
  readonly numFailedTestSuites: number;
  readonly numPassedTestSuites: number;
}

/**
 * Parses an events file. A line cut short by a kill, or anything that is not
 * a record, is skipped: only a whole `fileResult` line completes a file.
 */
export function parseJestEvents(text: string): JestEvent[] {
  const events: JestEvent[] = [];
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    try {
      const value: unknown = JSON.parse(line);
      if (
        typeof value === "object" &&
        value !== null &&
        typeof (value as { type?: unknown }).type === "string"
      ) {
        events.push(value as JestEvent);
      }
    } catch {
      // a partial last line of a killed process
    }
  }
  return events;
}

/**
 * An events file's text, only its first `cut` bytes when Squeal signalled
 * the process: what was written after the signal is not trusted (Kit K8).
 */
export function readEvents(path: string, cut: number | null): string {
  try {
    const bytes = readFileSync(path);
    return (cut === null ? bytes : bytes.subarray(0, cut)).toString("utf8");
  } catch {
    return "";
  }
}

/** The file's size in bytes; 0 when it is not there yet. */
export function sizeOf(path: string): number {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
}

/** The file's text; empty when it cannot be read. */
export function readOr(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}
