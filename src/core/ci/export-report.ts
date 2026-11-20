import { testFileId } from "../keys/reverse-index.js";
import type { DaemonKeying } from "../scheduler/daemon-keying.js";
import type { ProjectName, RelativePath } from "../types/common.js";
import type { TestFileRef } from "../types/keys.js";
import type { CheckRunResult, LoadedList, RunnerClosure, RunReport } from "../types/runner.js";
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

/**
 * Keys `passed` as a daemon's start and record do (`DaemonKeying`): each
 * file the runner lists by its closure, then with what its shard observed
 * beyond it, stored in the job's store. Returns the runner's closures and
 * the report of the files keyed; a file the runner does not list, or whose
 * closure fails, is in neither, and a file `leftOut` names by its closure
 * is only counted.
 */
export async function keyFiles(
  keying: DaemonKeying,
  passed: readonly PartFile[],
  leftOut: (file: PartFile, closure: RunnerClosure) => boolean,
): Promise<{ closures: ReadonlyMap<string, RunnerClosure>; report: RunReport; inspected: number }> {
  const { closures, leftOut: inspected } = await keying.keyFiles(passed, { leftOut });
  const { keys } = keying;
  const environmentFiles = (project: ProjectName) => new Set(keys.environmentFiles(project));
  const report = partsReport(
    passed.filter((file) => closures.has(testFileId(refOf(file)))),
    environmentFiles,
  );
  await keying.grow(report);
  return { closures, report, inspected };
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
