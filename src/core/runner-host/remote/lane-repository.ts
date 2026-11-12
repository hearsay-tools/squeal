import { createInputMatcher } from "../../keys/glob.js";
import { testFileId } from "../../keys/reverse-index.js";
import type { CheckError } from "../../types/check.js";
import type { TestFileRef } from "../../types/keys.js";
import type { RunReport } from "../../types/runner.js";

/*
 * Spec 021 D19.2 (row 021-23): the tests that read the repository itself.
 * A remote tree has no `.git` (D10), so the files `remote.needsRepository`
 * matches always run here. A guard backs the setting: a remote run whose
 * failure carries Git's own "not a git repository" text keeps no result for
 * that file; the lane runs it here, runs it here from then on, and status
 * names it with the hint to add it to the setting. A false failure is never
 * stored as current (`boat-trial.md` D2: ten such files were).
 */

/** Git's text for a directory outside any repository: `fatal: not a git repository (or any ...): .git`. */
export const NOT_A_REPOSITORY = /not a git repository/i;

/** The files of a background tier that run here, and the guard's memory of the ones a remote failed. */
export interface RepositoryRoute {
  /** `testFiles` split: those that need the repository run here, the others may go remote. */
  split(testFiles: readonly TestFileRef[]): {
    readonly here: readonly TestFileRef[];
    readonly there: readonly TestFileRef[];
  };
  /** The files of a remote `report` whose failure carries Git's text, now kept here; status names them. */
  guard(report: RunReport): readonly TestFileRef[];
}

/** The route over `needsRepository`, read at each split, so a policy reload applies to the next tier. */
export function repositoryRoute(
  needsRepository: () => readonly string[],
  named: (text: string) => void,
): RepositoryRoute {
  const failed = new Map<string, TestFileRef>();
  let globs: readonly string[] = [];
  let matches = createInputMatcher(globs);
  const here = (file: TestFileRef) => {
    const now = needsRepository();
    if (now !== globs) {
      globs = now;
      matches = createInputMatcher(now);
    }
    return failed.has(testFileId(file)) || matches(file.path);
  };
  return {
    split(testFiles) {
      const stays = testFiles.map(here);
      return {
        here: testFiles.filter((_, i) => stays[i]),
        there: testFiles.filter((_, i) => !stays[i]),
      };
    },
    guard(report) {
      const found = notARepository(report);
      if (found.length === 0) return found;
      for (const file of found) failed.set(testFileId(file), file);
      const paths = [...failed.values()].map((file) => file.path).sort();
      const shown = paths.length > 5 ? [...paths.slice(0, 5), `${paths.length - 5} more`] : paths;
      named(
        `test files that failed on the remote as not a Git repository run here: ${shown.join(", ")}; add each to remote.needsRepository in squeal.config.json`,
      );
      return found;
    },
  };
}

/** The files of `report` with a failure or a file error that carries Git's text, or a setup failure's files. */
export function notARepository(report: RunReport): TestFileRef[] {
  const files = new Map<string, TestFileRef>();
  const add = (file: TestFileRef) => files.set(testFileId(file), file);
  for (const result of report.results) {
    if (result.outcome === "fail" && result.errors.some(carries)) {
      add({ project: result.check.project, path: result.check.testPath });
    }
  }
  for (const error of report.fileErrors) if (error.errors.some(carries)) add(error.testFile);
  const startup = report.startupFailure;
  if (startup !== undefined && carries(startup.error))
    for (const file of startup.testFiles) add(file);
  return [...files.values()];
}

function carries(error: CheckError): boolean {
  return NOT_A_REPOSITORY.test(error.message) || NOT_A_REPOSITORY.test(error.stack ?? "");
}

/** `report` with nothing of `files`: none of their results is stored. */
export function withoutFiles(report: RunReport, files: readonly TestFileRef[]): RunReport {
  const gone = new Set(files.map(testFileId));
  const kept = <T extends { readonly testFile: TestFileRef }>(list: readonly T[] | undefined) =>
    list?.filter((item) => !gone.has(testFileId(item.testFile)));
  const keptRefs = (list: readonly TestFileRef[] | undefined) =>
    list?.filter((file) => !gone.has(testFileId(file)));
  const { startupFailure, ...rest } = report;
  const startupLeft = startupFailure?.testFiles.some((f) => !gone.has(testFileId(f))) === true;
  const optional = {
    fileDurations: kept(report.fileDurations),
    observed: kept(report.observed),
    reads: kept(report.reads),
    skippedFiles: kept(report.skippedFiles),
    focused: kept(report.focused),
    withheld: keptRefs(report.withheld),
  };
  return {
    ...rest,
    completedFiles: keptRefs(report.completedFiles) ?? [],
    results: report.results.filter(
      (r) => !gone.has(testFileId({ project: r.check.project, path: r.check.testPath })),
    ),
    fileErrors: kept(report.fileErrors) ?? [],
    ...Object.fromEntries(Object.entries(optional).filter(([, value]) => value !== undefined)),
    ...(startupLeft ? { startupFailure } : {}),
  };
}
