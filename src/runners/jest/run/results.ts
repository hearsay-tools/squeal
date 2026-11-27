import { join } from "node:path";
import { stripVTControlCharacters } from "node:util";
import type { WorktreePaths } from "../../../core/fs/worktree-paths.js";
import type { CheckError, RunOutcome } from "../../../core/types/check.js";
import type { AbsolutePath, RelativePath, SourceLocation } from "../../../core/types/common.js";
import type { TestFileRef } from "../../../core/types/keys.js";
import type { CheckRunResult, FileLevelError, RunEnd } from "../../../core/types/runner.js";
import type { ProcessExit } from "../../process/group.js";
import {
  type FileResultEvent,
  type JestCase,
  type JestErrorDetail,
  type JestEvent,
  readOr,
} from "./events.js";

/** What one completed test file of a batch reports (spec 028 D5.2). */
export interface JestFileReport {
  readonly testFile: TestFileRef;
  readonly results: readonly CheckRunResult[];
  readonly fileError: FileLevelError | null;
  readonly durationMs: number;
  /** Project modules `observe-runtime.cjs` saw the file load, the file among them; `[]` without it. */
  readonly loaded: readonly RelativePath[];
  /** Row 028-08: what Jest's transform and resolver read with success for it; absolute. */
  readonly reads: readonly AbsolutePath[];
}

/** Spec 028 D5.2: Jest's statuses; `skipped` and `disabled` are the legacy runner's. */
const OUTCOMES: Readonly<Record<string, RunOutcome>> = {
  passed: "pass",
  failed: "fail",
  pending: "skip",
  todo: "skip",
  skipped: "skip",
  disabled: "skip",
};

/** The check name's separator, Vitest's (`src/runners/vitest/results.ts`). */
export const NAME_SEPARATOR = " > ";

/**
 * The reports of the batch's completed files: those with a whole
 * `fileResult` line, in event order (Kit K8). A file with only `fileStart`
 * and `case` lines is left out, so the caller reports it unfinished. Results
 * come from the `fileResult`'s `testResults`, since Jest streams no case for
 * a skipped or todo test (research 028-01 F4.2).
 */
export function readJestBatch(
  events: readonly JestEvent[],
  files: readonly TestFileRef[],
  paths: WorktreePaths,
): JestFileReport[] {
  const byPath = new Map(files.map((f) => [f.path, f]));
  const reports: JestFileReport[] = [];
  const seen = new Set<TestFileRef>();
  for (const event of events) {
    if (event.type !== "fileResult") continue;
    const relative = paths.toRelative(event.testFilePath as AbsolutePath);
    const testFile = relative === null ? undefined : byPath.get(relative);
    if (testFile === undefined || seen.has(testFile)) continue;
    seen.add(testFile);
    reports.push(fileReport(event, testFile, paths));
  }
  return reports;
}

function fileReport(
  event: FileResultEvent,
  testFile: TestFileRef,
  paths: WorktreePaths,
): JestFileReport {
  const names = checkNames(event.testResults);
  const results = event.testResults.flatMap((c, i): CheckRunResult[] => {
    const outcome = Object.hasOwn(OUTCOMES, c.status) ? OUTCOMES[c.status] : undefined;
    if (outcome === undefined) return [];
    return [
      {
        check: {
          kind: "test",
          project: testFile.project,
          testPath: testFile.path,
          fullName: names[i] as string,
        },
        outcome,
        durationMs: c.duration ?? 0,
        location: c.location === null ? null : { path: testFile.path, ...c.location },
        errors: outcome === "fail" ? caseErrors(c, paths) : [],
      },
    ];
  });
  const errors = fileErrors(event, paths);
  const loaded = event.loaded.flatMap((p) =>
    paths.isProjectFile(p as AbsolutePath)
      ? [paths.toRelative(p as AbsolutePath) as RelativePath]
      : [],
  );
  return {
    testFile,
    results,
    fileError: errors.length === 0 ? null : { testFile, errors },
    durationMs: Math.round(event.durationMs ?? results.reduce((sum, r) => sum + r.durationMs, 0)),
    loaded:
      loaded.length === 0 || loaded.includes(testFile.path)
        ? loaded
        : [testFile.path, ...loaded].sort(),
    reads: (event.reads ?? []) as readonly AbsolutePath[],
  };
}

/**
 * Spec 028 D5.2, spec 001 D4: `[...ancestorTitles, title]` joined by
 * `NAME_SEPARATOR`, in declaration order. A name seen before in the file
 * takes its line from `--testLocationInResults`, `(line N)`, and an ordinal
 * when that is taken too, `(line N, 2)`, as `test.each` cases on one line
 * are: Vitest's rule (`checkNames` in `src/runners/vitest/results.ts`).
 */
export function checkNames(
  cases: readonly Pick<JestCase, "title" | "ancestorTitles" | "location">[],
): string[] {
  const used = new Set<string>();
  return cases.map((c) => {
    const full = [...c.ancestorTitles, c.title].join(NAME_SEPARATOR);
    let name = full;
    if (used.has(name)) {
      const line = c.location === null ? "line ?" : `line ${c.location.line}`;
      name = `${full} (${line})`;
      for (let n = 2; used.has(name); n++) name = `${full} (${line}, ${n})`;
    }
    used.add(name);
    return name;
  });
}

/** One error per failure message, its detail beside it when Jest kept one. */
function caseErrors(c: JestCase, paths: WorktreePaths): CheckError[] {
  const messages = c.failureMessages.length > 0 ? c.failureMessages : ["the test failed"];
  return messages.map((text, i) => {
    const error = toCheckError(text, c.failureDetails[i] ?? null, paths);
    return TIMEOUT.test(error.message) ? { ...error, stage: "timeout" } : error;
  });
}

/** Jest's own timeout message (`jest-circus`), the same on 29 and 30. */
const TIMEOUT = /Exceeded timeout of \d+ ?ms/;

/**
 * D5.2: a file that failed to run (`testExecError`: a syntax error, a throw
 * at load, a missing `@jest-environment`, a ts-jest type error) is a
 * file-level error. So are obsolete snapshot entries: under `--ci` Jest
 * fails the run for them though every test passed.
 */
function fileErrors(event: FileResultEvent, paths: WorktreePaths): CheckError[] {
  const errors: CheckError[] = [];
  const exec = event.testExecError;
  if (exec !== null) {
    const text =
      exec.stack ?? exec.message ?? event.failureMessage ?? "the test file failed to run";
    const error = toCheckError(text, exec, paths);
    errors.push({ ...error, phase: event.testResults.length === 0 ? "load" : "after-tests" });
  }
  const { unchecked, uncheckedKeys } = event.snapshot;
  if (unchecked > 0) {
    const keys = uncheckedKeys.map((k) => JSON.stringify(k)).join(", ");
    errors.push({
      name: "ObsoleteSnapshot",
      message: `${unchecked} obsolete snapshot ${unchecked === 1 ? "entry" : "entries"} that no test checks: ${keys}; remove ${unchecked === 1 ? "it" : "them"} with \`jest --ci=false -u\` on this file`,
      stack: null,
      location: null,
      diff: null,
      phase: "after-tests",
    });
  }
  return errors;
}

/**
 * A Jest failure as a `CheckError`, ANSI codes and worktree paths taken out
 * (`relativizeText`) so the text is the same in every worktree. `text` is
 * Jest's failure message, the error's message then its stack frames; the
 * detail, when present, gives the name, the message alone and the code.
 */
export function toCheckError(
  text: string,
  detail: JestErrorDetail | null,
  paths: WorktreePaths,
): CheckError {
  const clean = paths.relativizeText(text);
  const lines = clean.split("\n");
  const firstFrame = lines.findIndex((l) => FRAME_LINE.test(l));
  const head = (firstFrame < 0 ? lines : lines.slice(0, firstFrame)).join("\n").trimEnd();
  const parsed = /^([A-Za-z_$][\w$.]*): ([\s\S]*)$/.exec(head);
  const name = detail?.name ?? parsed?.[1] ?? "Error";
  const message =
    detail?.message != null ? paths.relativizeText(detail.message) : (parsed?.[2] ?? head);
  return {
    name,
    message,
    stack: clean === "" ? null : clean,
    location: projectFrame(text, paths),
    diff: null,
    ...(detail?.code != null ? { code: detail.code } : {}),
    ...(detail?.matcher === true ? { assertionEvidence: true as const } : {}),
  };
}

const FRAME_LINE = /^\s+at /;
const FRAME = /^\s+at (?:.*\()?(?:file:\/\/)?(\/[^()]+?):(\d+):(\d+)\)?$/;

/** The first stack frame in a project file, outside `node_modules` (research Q4's rule). */
function projectFrame(text: string, paths: WorktreePaths): SourceLocation | null {
  for (const line of stripVTControlCharacters(text).split("\n")) {
    const match = FRAME.exec(line);
    if (match === null) continue;
    const file = match[1] as AbsolutePath;
    if (paths.isProjectFile(file)) return paths.location(file, Number(match[2]), Number(match[3]));
  }
  return null;
}

/** What `ending` reads of a batch: its files, how its process ended, its stderr log's index, its reports. */
export interface BatchOutcome {
  readonly index: number;
  readonly files: readonly TestFileRef[];
  exit: ProcessExit | null;
  /** The events file's size when Squeal signalled the process; `null` when Squeal did not. */
  cut: number | null;
  /** Its completed files (`readJestBatch`). */
  reports: readonly JestFileReport[];
}

/**
 * How a run ends and which of its completed files it reports. `timed-out`
 * when the deadline passed; `completed` when every file completed;
 * otherwise `completed` naming the unfinished or withheld files when some
 * completed, `crashed` when none did. On a stop (`cancelled`), what
 * completed, no failure (Kit K8).
 *
 * A batch whose files all completed but whose process then ended abnormally
 * (`abnormal`), as a `globalTeardown` that throws after the reporter flushed
 * every file (review 0.1.643 B3), is withheld: its files are not completed,
 * since the scheduler stores a result only for a completed file.
 */
export function ending(
  batches: readonly BatchOutcome[],
  state: { readonly expired: boolean; readonly cancelled: boolean },
  options: {
    readonly files: readonly TestFileRef[];
    readonly timeoutMs: number | null;
    readonly logDir: AbsolutePath;
    readonly paths: WorktreePaths;
  },
): { end: RunEnd; failure: string | null; done: JestFileReport[] } {
  const withheld = batches.filter((b) => abnormal(b, options.logDir));
  const done = batches.filter((b) => !withheld.includes(b)).flatMap((b) => b.reports);
  if (state.cancelled) return { end: "completed", failure: null, done };
  const total = options.files.length;
  if (state.expired) {
    const left = total - done.length;
    const failure = `deadline of ${options.timeoutMs} ms passed with ${left} of ${total} test files unfinished`;
    return { end: "timed-out", failure, done };
  }
  const finished = new Set(batches.flatMap((b) => b.reports.map((r) => r.testFile)));
  const unfinished = batches.filter((b) => b.files.some((f) => !finished.has(f)));
  const what = withheld.map((b) => {
    const names = b.files.map((f) => f.path).join(", ");
    const log = options.paths.relativizeText(stderrLog(b, options.logDir));
    return `jest exited abnormally after ${names} completed (${describeExit(b, options)}; log ${log})`;
  });
  if (unfinished.length > 0) {
    const each = unfinished.map((b) => {
      const names = b.files.filter((f) => !finished.has(f)).map((f) => f.path);
      return `${names.join(", ")} (${describeExit(b, options)})`;
    });
    what.push(`jest ended without a result for ${each.join(", ")}`);
  }
  if (what.length === 0) return { end: "completed", failure: null, done };
  return { end: done.length === 0 ? "crashed" : "completed", failure: what.join("; "), done };
}

/**
 * A batch Squeal did not signal whose files all completed, yet whose process
 * did not end as Jest does after them: an error starting it, a signal, an
 * exit code other than 0 and 1, exit 1 that no failed test or file error of
 * the batch explains, or exit 1 with Jest's words for a throwing
 * `globalTeardown` in its stderr, the same on 29 and 30 (`runGlobalHook`).
 */
function abnormal(batch: BatchOutcome, logDir: AbsolutePath): boolean {
  const exit = batch.exit;
  if (exit === null || batch.cut !== null) return false;
  if (batch.reports.length < batch.files.length) return false;
  if (exit.error !== null || exit.signal !== null) return true;
  if (exit.code === 0) return false;
  if (exit.code !== 1) return true;
  const failed = batch.reports.some(
    (r) => r.fileError !== null || r.results.some((c) => c.outcome === "fail"),
  );
  return !failed || readOr(stderrLog(batch, logDir)).includes(TEARDOWN_ERROR);
}

const TEARDOWN_ERROR = "Jest: Got error running globalTeardown - ";

/** Lines and characters of the stderr log an exit's description quotes. */
const EXCERPT_LINES = 3;
const EXCERPT_CHARS = 600;

function stderrLog(batch: BatchOutcome, logDir: AbsolutePath): string {
  return join(logDir, `stderr-${batch.index}.log`);
}

function describeExit(
  batch: BatchOutcome,
  options: { readonly logDir: AbsolutePath; readonly paths: WorktreePaths },
): string {
  const exit = batch.exit;
  if (exit === null) return "not started";
  if (exit.error !== null) return `cannot run node: ${exit.error}`;
  const how = exit.signal === null ? `exit code ${exit.code}` : `signal ${exit.signal}`;
  // Stack frames name Jest's own files; the lines around them say what went wrong.
  const tail = options.paths
    .relativizeText(readOr(stderrLog(batch, options.logDir)))
    .split("\n")
    .filter((line) => line.trim() !== "" && !/^\s+at /.test(line))
    .slice(-EXCERPT_LINES)
    .map((line) => line.trim())
    .join(" | ");
  if (tail === "") return how;
  return `${how}: ${tail.length > EXCERPT_CHARS ? `${tail.slice(0, EXCERPT_CHARS)}…` : tail}`;
}
