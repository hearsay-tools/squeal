import { compare } from "../fs/compare.js";
import type { ProjectName, RelativePath } from "../types/common.js";
import type { TestFileRef } from "../types/keys.js";
import type { LoadedList, RunReport } from "../types/runner.js";

/*
 * Spec 022 D2: a run's loaded lists (D1) join its files' observed inputs.
 * The Vitest adapter joins its own run's lists; `ci export` joins the
 * lists `ci record` carried in each part file, with this checkout's
 * environment files, so a CI-recorded file keys as the daemon keys it
 * (row 020-51; review of 0.1.493 B1).
 */

/**
 * Spec 022 D2: `report` with the run's loaded lists (D1). While the
 * instance observes (`report.observed` is there, policy
 * `observe.runtimeInputs`), each list's paths join its file's observed
 * paths and module loads, less the files the project's environment hash
 * holds (`environmentFiles`: setup files and their closures, which every
 * file loads). The core drops the paths the file's closure holds. Without
 * observation no list joins a key; the lists are stored all the same (D3).
 */
export function withLoaded(
  report: RunReport,
  lists: readonly LoadedList[],
  environmentFiles: (project: ProjectName) => ReadonlySet<RelativePath>,
): RunReport {
  if (lists.length === 0) return report;
  if (report.observed === undefined) return { ...report, loaded: lists };
  const observed = new Map(report.observed.map((o) => [refKey(o.testFile), o]));
  for (const { testFile, paths } of lists) {
    const held = environmentFiles(testFile.project);
    const loaded = paths.filter((path) => !held.has(path));
    if (loaded.length === 0) continue;
    const found = observed.get(refKey(testFile));
    observed.set(refKey(testFile), {
      ...(found ?? { testFile, directories: [] }),
      paths: union(found?.paths ?? [], loaded),
      modules: union(found?.modules ?? [], loaded),
    });
  }
  return { ...report, observed: [...observed.values()], loaded: lists };
}

const refKey = (ref: TestFileRef) => `${ref.project}\0${ref.path}`;

function union(a: readonly RelativePath[], b: readonly RelativePath[]): RelativePath[] {
  return [...new Set([...a, ...b])].sort(compare);
}
