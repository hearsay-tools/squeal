import { compare } from "../../fs/compare.js";
import { testFileId } from "../../keys/reverse-index.js";
import { type HostLoad, loadAllows } from "../../retry/load.js";
import { listPaths } from "../../text.js";
import type { RelativePath } from "../../types/common.js";
import type { TestFileRef } from "../../types/keys.js";
import type { RunReport } from "../../types/runner.js";
import type { KnownEvidence } from "./prerun.js";
import type { GateRunReport } from "./report.js";
import type { FileRetry, StoredRerun, TestFileEvidence } from "./types.js";

/*
 * Spec 020 D3.4 as amended by row 020-54 (#210; the human, 2026-11-13:
 * "Retry once"): a selected file that fails here while the host's load is
 * over the daemon's threshold runs once more, after the other files and
 * inside the budget. The measure and the threshold are the daemon's own
 * (`hostLoad`, `loadAllows`, spec 001 D6's load gate): the one-minute load
 * average against the CPU count, sampled when the run that failed it ends.
 * The rerun's result is the file's result, and a failure that fails again
 * stays failed. Evidence from the stores or the parts never reruns, nor a
 * failure below the threshold, nor one with no budget left. Before, a
 * timing test that failed under load cost a whole gate rerun.
 * Row 020-60 (#200, #214; the human, 2026-11-14: "Stored fail: Explain +
 * flag"): a failure read from the stores is named after the verdict, with
 * the command that reruns it; with `--rerun-stored-failures` each such
 * file runs once more, after every other run, and its rerun's result is
 * the file's. A stored pass never reruns.
 */

/** The files of one run that failed while the host's load was over the threshold, and that load. */
export interface Overloaded {
  readonly load: { readonly oneMinute: number; readonly cpus: number };
  readonly files: readonly TestFileRef[];
}

/** The files of `files` that completed in `report` with a failed test or a file-level error. */
export function failedIn(files: readonly TestFileRef[], report: RunReport): TestFileRef[] {
  const completed = new Set(report.completedFiles.map(testFileId));
  const failed = new Set([
    ...report.fileErrors.map((e) => testFileId(e.testFile)),
    ...report.results
      .filter((r) => r.outcome === "fail")
      .map((r) => testFileId({ project: r.check.project, path: r.check.testPath })),
  ]);
  return files.filter((ref) => completed.has(testFileId(ref)) && failed.has(testFileId(ref)));
}

/**
 * The files of a run of `files` that failed, with the host's load, which
 * `load` samples now, when the daemon's gate would hold a `load` retry
 * (`loadAllows`); `null` when none failed, when the load is below the CPU
 * count or not known, or when no budget is left (`leftMs`).
 */
export function overloadedOf(
  files: readonly TestFileRef[],
  report: RunReport | null,
  load: () => HostLoad,
  leftMs: number,
): Overloaded | null {
  if (report === null || leftMs <= 0) return null;
  const failed = failedIn(files, report);
  if (failed.length === 0) return null;
  const sample = load();
  if (loadAllows(sample) || sample.oneMinute === null) return null;
  return { load: { oneMinute: sample.oneMinute, cpus: sample.cpus }, files: failed };
}

/**
 * The evidence of a first run's `files` (`ran`, in their order) after the
 * rerun of `overloaded.files` (`rerun`, in theirs): each such file's is
 * its rerun's when the rerun completed it, else its first run's; each
 * with `retried`. `null` for `rerun` when it did not start: the budget
 * ended first, and nothing changes.
 */
export function afterRetry(
  files: readonly TestFileRef[],
  ran: readonly TestFileEvidence[],
  overloaded: Overloaded,
  rerun: readonly TestFileEvidence[] | null,
): TestFileEvidence[] {
  if (rerun === null) return [...ran];
  const again = new Map(overloaded.files.map((ref, i) => [testFileId(ref), rerun[i]]));
  const { oneMinute, cpus } = overloaded.load;
  const load = Math.round(oneMinute * 100) / 100;
  return ran.map((first, i) => {
    const id = testFileId(files[i] ?? { project: "", path: first.path });
    if (!again.has(id)) return first;
    const second = again.get(id);
    if (second?.completed !== true) {
      return { ...first, retried: { load, cpus, outcome: "not-finished" } };
    }
    const outcome = second.failed.length > 0 ? "failed" : "passed";
    return { ...second, retried: { load, cpus, outcome } };
  });
}

/** D7's `runs[].retried`: each file of `files` that ran again, by path; `null` when none did. */
export function retriedOf(
  files: readonly TestFileEvidence[],
): Record<RelativePath, FileRetry> | null {
  const retried = files.flatMap((f) =>
    f.retried === undefined ? [] : [[f.path, f.retried] as const],
  );
  if (retried.length === 0) return null;
  return Object.fromEntries(retried.sort(([a], [b]) => compare(a, b)));
}

/** The files the stderr line names per outcome, as the parts' refusal lines do; the report lists all. */
const RETRIED_NAMES = 3;

/** How each outcome reads in the stderr line, in its order. */
const OUTCOMES: readonly (readonly [FileRetry["outcome"], string])[] = [
  ["passed", "passed"],
  ["failed", "failed again"],
  ["not-finished", "did not finish, so the first failure stands"],
];

/**
 * The one stderr line after the verdict when a file ran again: how many,
 * the highest load and CPU count they first failed under, and each
 * outcome's count with at most `RETRIED_NAMES` names; "" when none ran again.
 */
export function retriedText(runs: readonly GateRunReport[]): string {
  const retried = runs.flatMap((run) => Object.entries(run.retried ?? {}));
  if (retried.length === 0) return "";
  const highest = retried
    .map(([, r]) => r)
    .reduce((top, r) => (r.load / r.cpus > top.load / top.cpus ? r : top));
  const outcomes = OUTCOMES.flatMap(([outcome, said]) => {
    const paths = retried.filter(([, r]) => r.outcome === outcome).map(([path]) => path);
    return paths.length === 0
      ? []
      : [`${paths.length} ${said} (${listPaths(paths.sort(compare), RETRIED_NAMES)})`];
  });
  const count = retried.length === 1 ? "1 test file" : `${retried.length} test files`;
  const load = `${highest.load} on ${highest.cpus} CPUs`;
  return `squeal code: ${count} failed while the host load was at or over its CPU count (${load}) and ran once more: ${outcomes.join(", ")}.\n`;
}

/** Row 020-60: the files of `chosen` whose known evidence is a stored failure marked to run again. */
export function storedToRerun(chosen: readonly TestFileRef[], known: KnownEvidence): TestFileRef[] {
  return chosen.filter((ref) => known.get(ref)?.storedRerun !== undefined);
}

/** Row 020-60: one rerun of stored failures, `files` in its order, and each file's evidence of it. */
export interface StoredRerunRun {
  readonly files: readonly TestFileRef[];
  readonly ran: readonly TestFileEvidence[];
}

/**
 * Row 020-60: `testFiles` after the reruns of stored failures: a file whose
 * rerun completed reads its rerun's evidence, with `storedRerun` passed or
 * failed; any other keeps its stored evidence, marked `not-finished`. The
 * stored evidence is matched by identity with `known`'s.
 */
export function afterStoredRerun(
  testFiles: readonly TestFileEvidence[],
  known: KnownEvidence,
  reruns: readonly StoredRerunRun[],
): TestFileEvidence[] {
  const replaced = new Map<TestFileEvidence, TestFileEvidence>();
  for (const { files, ran } of reruns) {
    files.forEach((ref, i) => {
      const stored = known.get(ref);
      const second = ran[i];
      if (stored === undefined || second?.completed !== true) return;
      const outcome = second.failed.length > 0 ? "failed" : "passed";
      replaced.set(stored, { ...second, storedRerun: { outcome } });
    });
  }
  return testFiles.map((f) => replaced.get(f) ?? f);
}

/** D7's `runs[].storedRerun`: each stored failure that was to run again, by path; `null` when none. */
export function storedRerunOf(
  files: readonly TestFileEvidence[],
): Record<RelativePath, StoredRerun> | null {
  const reran = files.flatMap((f) =>
    f.storedRerun === undefined ? [] : [[f.path, f.storedRerun] as const],
  );
  if (reran.length === 0) return null;
  return Object.fromEntries(reran.sort(([a], [b]) => compare(a, b)));
}

/** Row 020-60: the flag that reruns stored failures once. */
export const RERUN_STORED_FLAG = "--rerun-stored-failures";

const failedFiles = (n: number) => (n === 1 ? "1 failed test file" : `${n} failed test files`);

/**
 * Row 020-60: the stderr line after the verdict naming the failed files
 * the stores gave that did not run again, at most `RETRIED_NAMES`, and
 * `command`, which reruns them once; "" when none.
 */
export function storedFailuresText(runs: readonly GateRunReport[], command: string): string {
  const named = runs.flatMap((run) => {
    const failed = new Set(run.failed.map((f) => f.path));
    return Object.entries(run.from ?? {})
      .filter(([path, from]) => from === "store" && failed.has(path))
      .filter(([path]) => run.storedRerun?.[path] === undefined)
      .map(([path]) => path);
  });
  const paths = [...new Set(named)].sort(compare);
  if (paths.length === 0) return "";
  const one = paths.length === 1;
  const names = listPaths(paths, RETRIED_NAMES);
  const read = `${failedFiles(paths.length)} ${one ? "was" : "were"} read from the stores`;
  return `squeal code: ${read} and did not run here (${names}). To run ${one ? "it" : "them"} once more: ${command}\n`;
}

/** How each stored rerun's outcome reads in its stderr line, in its order. */
const STORED_OUTCOMES: readonly (readonly [StoredRerun["outcome"], string])[] = [
  ["passed", "passed"],
  ["failed", "failed again"],
  ["not-finished", "did not finish, so the stored failure stands"],
];

/**
 * Row 020-60: the one stderr line after the verdict when stored failures
 * ran once more: how many, and each outcome's count with at most
 * `RETRIED_NAMES` names; "" when none did.
 */
export function storedRerunText(runs: readonly GateRunReport[]): string {
  const reran = runs.flatMap((run) => Object.entries(run.storedRerun ?? {}));
  if (reran.length === 0) return "";
  const outcomes = STORED_OUTCOMES.flatMap(([outcome, said]) => {
    const paths = reran.filter(([, r]) => r.outcome === outcome).map(([path]) => path);
    return paths.length === 0
      ? []
      : [`${paths.length} ${said} (${listPaths(paths.sort(compare), RETRIED_NAMES)})`];
  });
  return `squeal code: ${failedFiles(reran.length)} read from the stores ran once more (${RERUN_STORED_FLAG}): ${outcomes.join(", ")}.\n`;
}
