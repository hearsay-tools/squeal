import { createInputMatcher } from "../../keys/glob.js";
import { testFileId } from "../../keys/reverse-index.js";
import type { CheckError } from "../../types/check.js";
import type { TestFileRef } from "../../types/keys.js";
import type { RunReport } from "../../types/runner.js";

/*
 * Spec 021 D19.2 (row 021-23): the tests that read the repository itself.
 * A remote tree has no `.git` (D10), so the files `remote.needsRepository`
 * matches always run here. A guard backs the setting: a remote run whose
 * failure carries Git's own diagnostic for a missing repository keeps no
 * result for that file; the lane runs it here, runs it here from then on,
 * and status names it with the hint to add it to the setting. A false
 * failure is never stored as current (`boat-trial.md` D2: ten such files
 * were).
 *
 * Review 0.1.457 B1 and B2: the diagnostic is Git's own fatal line, one
 * rule for every error a report holds: the error's message and each of its
 * causes, of a test, of a file and of a setup. A failure that only quotes
 * the words, in an assertion or a stack, is a real failure: it stays a
 * remote failure, and its file is not remembered.
 */

/**
 * Git's fatal line for a directory outside any repository, at the start of a
 * line, with one of Git's own continuations: `fatal: not a git repository
 * (or any of the parent directories): .git`, `... (or any parent up to mount
 * point /x)`, and with `GIT_DIR` set `fatal: not a git repository: '/x/.git'`
 * (`Not` in Git before 2.x). A cause keeps its first line, capped at 200
 * characters, so the line's end is not required.
 */
const MISSING_REPOSITORY = /^fatal: not a git repository(?: \(or any |: |$)/im;

/** Whether `error`, or one of its causes, is Git's diagnostic for a missing repository. */
export function missingRepository(error: CheckError): boolean {
  const texts = [error.message, ...(error.causes ?? []).map((cause) => cause.message)];
  return texts.some((text) => MISSING_REPOSITORY.test(text));
}

/** The files of a background tier that run here, and the guard's memory of the ones a remote failed. */
export interface RepositoryRoute {
  /** `testFiles` split: those that need the repository run here, the others may go remote. */
  split(testFiles: readonly TestFileRef[]): {
    readonly here: readonly TestFileRef[];
    readonly there: readonly TestFileRef[];
  };
  /** The files of a remote `report` that failed for want of the repository, now kept here; status names them. */
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

/** The files of `report` whose failed test, file error or setup failure is `missingRepository`. */
export function notARepository(report: RunReport): TestFileRef[] {
  const files = new Map<string, TestFileRef>();
  const add = (file: TestFileRef) => files.set(testFileId(file), file);
  for (const result of report.results) {
    if (result.outcome === "fail" && result.errors.some(missingRepository)) {
      add({ project: result.check.project, path: result.check.testPath });
    }
  }
  for (const error of report.fileErrors) {
    if (error.errors.some(missingRepository)) add(error.testFile);
  }
  const startup = report.startupFailure;
  if (startup !== undefined && missingRepository(startup.error)) {
    for (const file of startup.testFiles) add(file);
  }
  return [...files.values()];
}

/**
 * Review 0.1.457 B3: `report`, whose run failed to start, with `files`, a
 * later part of the tier that did not run, among its setup failure's files.
 * A report holds one setup failure, so a part after one that failed to start
 * does not run: the scheduler queues its files again, unless their project
 * is the one whose setup failed, whose files it blocks as it blocks the
 * failed part's (`failStartup`).
 */
export function deferredTo(report: RunReport, files: readonly TestFileRef[]): RunReport {
  const startup = report.startupFailure;
  if (startup === undefined) throw new Error("deferredTo: the report's run started");
  return { ...report, startupFailure: { ...startup, testFiles: [...startup.testFiles, ...files] } };
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
