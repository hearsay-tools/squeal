import { compare } from "../../fs/compare.js";
import type { GateFailedTests, GateFunctionReport } from "./report.js";
import type { TestFileEvidence } from "./types.js";

/*
 * Row 020-53 (#210): the failed tests behind a `test-failed` gap. D5.5
 * keeps one selected failure blocking every function; this names which
 * test failed, where its evidence came from, and whether its file is one
 * of the function's loaders, so a failure outside them does not read as
 * the function's own.
 */

/** The selected test files with a failed test, by path, each with its tests sorted. */
export function failedFiles(files: readonly TestFileEvidence[]): readonly TestFileEvidence[] {
  return files
    .filter((f) => f.failed.length > 0)
    .map((f) => ({ ...f, failed: [...f.failed].sort(compare) }))
    .sort((a, b) => compare(a.path, b.path));
}

/** `fn` with the failed tests behind its gap when that is `test-failed`; else `fn` as it is. */
export function withFailedTests(
  fn: GateFunctionReport,
  failed: readonly TestFileEvidence[],
): GateFunctionReport {
  if (fn.gap !== "test-failed") return fn;
  const loaders = new Set(fn.loaders.expected);
  const failedTests: GateFailedTests[] = failed.map((f) => ({
    path: f.path,
    tests: f.failed,
    from: f.from ?? "run",
    loader: loaders.has(f.path),
  }));
  return { ...fn, failedTests };
}
