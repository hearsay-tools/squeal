import type { TestFileRef } from "../types/keys.js";
import type { CheckRunResult, RunReport } from "../types/runner.js";
import type { PartFile } from "./parts.js";

/*
 * Spec 018 D9 (row 018-17): the shards' passes and skips as the run report
 * a daemon's own run of the same files would give its record path, so the
 * export stores their results (`recordsForFile`) and grows their closures
 * (`observedGrowth`) with the daemon's code. Failures never reach it: the
 * export leaves a failed file out whole (D2).
 */

/** One completed run of `files`, each with its checks, its duration and what its shard observed. */
export function partsReport(files: readonly PartFile[]): RunReport {
  return {
    end: "completed",
    durationMs: 0,
    completedFiles: files.map(refOf),
    results: files.flatMap(results),
    fileErrors: [],
    failure: null,
    fileDurations: files.flatMap((file) =>
      file.durationMs === null ? [] : [{ testFile: refOf(file), durationMs: file.durationMs }],
    ),
    observed: files.flatMap((file) =>
      file.observed === undefined ? [] : [{ testFile: refOf(file), ...file.observed }],
    ),
  };
}

/** A file's checks as the Vitest adapter reports them: the location in the test file itself. */
function results(file: PartFile): CheckRunResult[] {
  return file.checks.map((check) => ({
    check: { kind: "test", project: file.project, testPath: file.path, fullName: check.fullName },
    outcome: check.outcome,
    durationMs: check.durationMs,
    location: check.location === null ? null : { path: file.path, ...check.location },
    errors: [],
  }));
}

function refOf(file: PartFile): TestFileRef {
  return { project: file.project, path: file.path };
}
