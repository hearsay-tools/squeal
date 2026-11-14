import type { ProjectName, RelativePath } from "../types/common.js";
import type { TestFileRef } from "../types/keys.js";
import type { CheckRunResult, LoadedList, RunReport } from "../types/runner.js";
import { withLoaded } from "./loaded-inputs.js";
import type { PartFile } from "./parts.js";

/*
 * Spec 018 D9 (row 018-17): the shards' passes and skips as the run report
 * a daemon's own run of the same files would give its record path, so the
 * export stores their results (`recordsForFile`) and grows their closures
 * (`observedGrowth`) with the daemon's code. Failures never reach it: the
 * export leaves a failed file out whole (D2). Spec 022 D2: each file's
 * loaded list joins what it observed, less `environmentFiles`, as the
 * daemon's adapter joins its own run's (review of 0.1.493 B1); the report
 * carries no list on, as no export stores one (D3).
 */

/** One completed run of `files`, each with its checks, its duration and what its shard observed. */
export function partsReport(
  files: readonly PartFile[],
  environmentFiles: (project: ProjectName) => ReadonlySet<RelativePath>,
): RunReport {
  const lists = files.flatMap((file): LoadedList[] =>
    file.loaded === undefined ? [] : [{ testFile: refOf(file), paths: file.loaded }],
  );
  const { loaded: _lists, ...report } = withLoaded(plainReport(files), lists, environmentFiles);
  return report;
}

function plainReport(files: readonly PartFile[]): RunReport {
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
