import { existsSync } from "node:fs";
import { compare } from "../../fs/compare.js";
import { testFileId } from "../../keys/reverse-index.js";
import type { AbsolutePath, RelativePath } from "../../types/common.js";
import type { TestFileRef } from "../../types/keys.js";
import type { RunnerAdapter, RunReport } from "../../types/runner.js";
import type { Picked } from "./prerun.js";
import type { Mapped } from "./records.js";
import type { Runner } from "./runners.js";
import type { LeftOutFile } from "./scope.js";
import type { TestFileEvidence } from "./types.js";

/*
 * Spec 020 D3: what the collector knows of one selected test file, from
 * its run's report and its mapped record, and from its runner's closure
 * when it did not run (D14.2, D15.3).
 */

/** The failed name of a completed file's import or syntax failure, which has no test name. */
export const FILE_ERROR = "(file-level error)";

/** The sources `ref`'s closure loads, sorted; `null` when the runner cannot give its closure. */
export function loadsOf(adapter: RunnerAdapter, ref: TestFileRef): Promise<RelativePath[] | null> {
  return adapter.closure(ref).then(
    (closure) => [...closure.paths].sort(compare),
    () => null,
  );
}

/**
 * One selected file's evidence; a file that did not complete keeps no
 * failure, no skip and no record. A skipped test is D11.3's: its record
 * proves a pass and never a violation. With `children`, its child files
 * are counted, none when it has no record.
 */
export async function evidenceOf(
  runner: Runner,
  ref: TestFileRef,
  report: RunReport | null,
  records: ReadonlyMap<string, Mapped>,
  children: boolean,
): Promise<TestFileEvidence> {
  const key = testFileId(ref);
  const completed = report?.completedFiles.some((done) => testFileId(done) === key) === true;
  const own = (r: { testFile: TestFileRef }) => testFileId(r.testFile) === key;
  const results = !completed
    ? []
    : (report?.results ?? []).filter(
        (r) => r.check.project === ref.project && r.check.testPath === ref.path,
      );
  const failed = [
    ...(completed && report?.fileErrors.some(own) === true ? [FILE_ERROR] : []),
    ...results.filter((r) => r.outcome === "fail").map((r) => r.check.fullName),
  ];
  const skipped = results.some((r) => r.outcome === "skip");
  const loads = await loadsOf(runner.adapter, ref);
  const mapped = completed ? records.get(key) : undefined;
  const record = mapped?.record ?? null;
  const counts = children ? { children: mapped?.children ?? { read: 0, dropped: 0 } } : {};
  return {
    runner: runner.kind,
    path: ref.path,
    completed,
    failed,
    skipped,
    loads,
    record,
    ...counts,
  };
}

/**
 * Spec 013 V8 as amended (row 020-50, #207): one stderr line per file whose
 * worker Vitest timed out terminating (`warned`), saying whether its result
 * counts in this report, from the files' final evidence: it counts when the
 * file completed, its failed tests included, and does not when the report
 * lists it as not finished, as in a crashed run. It says nothing of
 * storage, which is the keeper's (D17.3). A warned path this command did
 * not run here, as one the stores served, gives no line.
 */
export function teardownLines(
  warned: Iterable<RelativePath>,
  files: readonly TestFileEvidence[],
): string[] {
  const lines: string[] = [];
  for (const path of [...new Set(warned)].sort(compare)) {
    const ran = files.filter(
      (f) => f.runner === "vitest" && f.path === path && f.from === undefined,
    );
    if (ran.length === 0) continue;
    const completed = ran.filter((f) => f.completed);
    const failed = completed.reduce((sum, f) => sum + f.failed.length, 0);
    const failures =
      failed === 0 ? "" : `, ${failed === 1 ? "1 failed test" : `${failed} failed tests`} included`;
    const what =
      completed.length === ran.length
        ? `the file completed, so its result counts in this report${failures}`
        : completed.length === 0
          ? "the report lists the file as not finished, so its result does not count"
          : `the file completed in ${completed.length} of its ${ran.length} projects, so its result counts in this report for those only${failures}`;
    lines.push(`squeal code: Vitest timed out terminating the worker of ${path}; ${what}.\n`);
  }
  return lines;
}

/**
 * Row 020-50 (#207): the files of each worker Vitest timed out terminating,
 * heard through `CollectOptions.teardown` until the adapters closed, and
 * their lines (`teardownLines`) once the evidence is final.
 */
export class TeardownWarnings {
  readonly #warned = new Set<RelativePath>();

  /** `CollectOptions.teardown`. */
  readonly hear = (files: readonly RelativePath[]): void => {
    for (const file of files) this.#warned.add(file);
  };

  /** Writes each line of the files heard, given the final evidence, to `write`. */
  tell(files: readonly TestFileEvidence[], write: (text: string) => void): void {
    for (const line of teardownLines(this.#warned, files)) write(line);
  }
}

/**
 * D14.2: each file the scope left out with its closure, read with no run
 * and no setup; `null` when the runner cannot give it. None with no scope.
 */
export async function leftOutFiles(picked: readonly Picked[]): Promise<LeftOutFile[]> {
  const files: LeftOutFile[] = [];
  for (const { kind, adapter, leftOut } of picked) {
    for (const { ref, group } of leftOut) {
      files.push({ runner: kind, path: ref.path, group, loads: await loadsOf(adapter, ref) });
    }
  }
  return files;
}

/**
 * #197 (row 020-40): the log folder kept of one runner kind's runs in which
 * a selected file failed or did not finish, one per kind, as the report has
 * one `runs` entry per kind. It is a run of the main store, under
 * `<store>/runs/`, so the store's prune removes it as it removes a daemon
 * run's log (spec 001 D8).
 */
export interface KeptLog {
  readonly runner: TestFileEvidence["runner"];
  readonly path: AbsolutePath;
}

/**
 * #197 (row 020-40): one runner kind's runs with a failed or unfinished
 * file, whose log folders the caller may keep as one (`CollectOptions.keepLog`).
 */
export interface RunLog {
  readonly runner: TestFileEvidence["runner"];
  /** The files those runs were given. */
  readonly files: readonly TestFileRef[];
  /**
   * Each run's log folder, in the collector's temporary folder, removed once
   * the runs end. One per node:test project, each writing only under
   * `node-test/<project>/`, so they merge into one folder with no clash.
   */
  readonly logDirs: readonly AbsolutePath[];
  /** The first end that is not `completed`, else `completed`; the durations summed. */
  readonly report: Pick<RunReport, "end" | "durationMs">;
}

/** #197 (row 020-40): one run as it ended, and the evidence of each file it was given. */
export interface EndedRun {
  readonly runner: TestFileEvidence["runner"];
  readonly files: readonly TestFileRef[];
  readonly logDir: AbsolutePath;
  /** `null` when the run did not start. */
  readonly report: RunReport | null;
  readonly ran: readonly TestFileEvidence[];
}

/**
 * #197 (row 020-40): the logs `keep` kept of `ended`, at most one per
 * runner kind, of the runs in which a file failed or did not finish. A run
 * whose files all completed with no failure, that did not start or that
 * wrote no log folder offers none; a kind none of whose runs offers one,
 * or whose log `keep` did not keep, has no entry.
 */
export async function keptLogs(
  keep: ((run: RunLog) => Promise<AbsolutePath | null>) | undefined,
  ended: readonly EndedRun[],
): Promise<KeptLog[]> {
  if (keep === undefined) return [];
  const logs: KeptLog[] = [];
  for (const runner of new Set(ended.map((run) => run.runner))) {
    const offered = ended.filter((run) => run.runner === runner && offersLog(run));
    if (offered.length === 0) continue;
    const path = await keep({
      runner,
      files: offered.flatMap((run) => run.files),
      logDirs: offered.map((run) => run.logDir),
      report: {
        end: offered.find((run) => run.report?.end !== "completed")?.report?.end ?? "completed",
        durationMs: offered.reduce((sum, run) => sum + (run.report?.durationMs ?? 0), 0),
      },
    });
    if (path !== null) logs.push({ runner, path });
  }
  return logs;
}

function offersLog({ report, logDir, ran }: EndedRun): boolean {
  if (report === null || !existsSync(logDir)) return false;
  return ran.some((file) => !file.completed || file.failed.length > 0);
}
