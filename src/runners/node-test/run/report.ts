import type { WorktreePaths } from "../../../core/fs/worktree-paths.js";
import type {
  CheckError,
  CheckRunResult,
  FileLevelError,
  RunOutcome,
  TestFileRef,
} from "../../../core/types/index.js";
import { identify, type ReportedTest } from "../identity.js";
import { stderrError, toCheckError } from "./errors.js";
import type { TestEvent, TestEventData } from "./events.js";

/** One test file's process: what Squeal passed and what its reporter wrote. */
export interface FileStream {
  readonly testFile: TestFileRef;
  /** The path as passed to `node --test`, relative to the project's `cwd`; the wrapper's name. */
  readonly arg: string;
  readonly events: readonly TestEvent[];
}

/** What one file's stream says. */
export interface FileReport {
  /**
   * The wrapper's `test:complete` and the run's final `test:summary` are both
   * in the stream. One file per process (coordinator, 2026-10-07): Node
   * forwards a child's events in report order and writes the final summary
   * after all of them, so the stream is whole. See
   * `test/fixtures/node-test/streams/README.md` for why the wrapper alone
   * is not enough.
   */
  readonly completed: boolean;
  readonly results: readonly CheckRunResult[];
  readonly fileError: FileLevelError | null;
  /** The wrapper's whole-process duration, startup included (runner-api 6). */
  readonly durationMs: number | null;
}

interface Reported extends ReportedTest {
  readonly event: TestEvent;
}

/**
 * Maps a file's stream to results (spec 003 D2, D5). Results come from the
 * report-ordered `test:pass` and `test:fail`, never from the exit code or
 * the console. Suites are name prefixes only; skip and todo directives are
 * the `skip` outcome; a test that failed only through its subtests passes,
 * since its own body passed, and its failing subtests carry the failure
 * (coordinator, 2026-10-07). A wrapper that failed while no check failed is
 * a `FileLevelError` with the file's stderr.
 */
export function readFileStream(stream: FileStream, paths: WorktreePaths): FileReport {
  const isWrapper = (data: TestEventData) =>
    data.nesting === 0 && data.name === stream.arg && data.entryFile === undefined;
  const wrapper = stream.events.find((e) => e.type === "test:complete" && isWrapper(e.data));
  const summary = stream.events.some((e) => e.type === "test:summary" && e.data.file === null);

  const reported: Reported[] = stream.events
    .filter((e) => (e.type === "test:pass" || e.type === "test:fail") && !isWrapper(e.data))
    .map((event) => ({
      event,
      name: event.data.name ?? "",
      nesting: event.data.nesting ?? 0,
      testId: event.data.testId,
      parentId: event.data.parentId,
      suite: event.data.details?.type === "suite",
      line: event.data.line ?? null,
    }));
  const results = identify(reported).map(({ test, fullName, ancestors }) =>
    toResult(stream.testFile, test.event, fullName, ancestors, paths),
  );

  const failed = wrapper?.data.details?.passed === false;
  const fileError =
    failed && !results.some((r) => r.outcome === "fail")
      ? { testFile: stream.testFile, errors: fileErrors(stream, reported, wrapper, paths) }
      : null;
  return {
    completed: wrapper !== undefined && summary,
    results,
    fileError,
    durationMs: wrapper?.data.details?.duration_ms ?? null,
  };
}

function outcome(event: TestEvent): RunOutcome {
  const { skip, todo, details } = event.data;
  if (skip !== undefined || todo !== undefined) return "skip";
  if (event.type === "test:pass") return "pass";
  return details?.error?.failureType === "subtestsFailed" ? "pass" : "fail";
}

function toResult(
  testFile: TestFileRef,
  event: TestEvent,
  fullName: string,
  ancestors: readonly Reported[],
  paths: WorktreePaths,
): CheckRunResult {
  const result = outcome(event);
  const { data } = event;
  const file = typeof data.file === "string" ? paths.toRelative(data.file) : null;
  return {
    check: { kind: "test", project: testFile.project, testPath: testFile.path, fullName },
    outcome: result,
    durationMs: data.details?.duration_ms ?? 0,
    location:
      data.line === undefined
        ? null
        : { path: file ?? testFile.path, line: data.line, column: data.column ?? 1 },
    errors: result === "fail" ? failureErrors(event, ancestors, paths) : [],
  };
}

/**
 * The test's own error; a test cancelled because its suite's hook failed also
 * carries that hook's error, the one worth reading.
 */
function failureErrors(
  event: TestEvent,
  ancestors: readonly Reported[],
  paths: WorktreePaths,
): CheckError[] {
  const own = toCheckError(event.data.details?.error, paths);
  if (event.data.details?.error?.failureType !== "cancelledByParent") return [own];
  const causes = ancestors.filter((a) => ownFailure(a.event)).reverse();
  return [own, ...causes.map((a) => toCheckError(a.event.data.details?.error, paths))];
}

/** A failure of the test or suite itself, not only of its subtests or its parent. */
function ownFailure(event: TestEvent): boolean {
  const type = event.data.details?.error?.failureType;
  return event.type === "test:fail" && type !== "subtestsFailed" && type !== "cancelledByParent";
}

/**
 * Failures of suites, which are not checks (a `describe` callback that
 * throws); then the file's stderr, where Node and tsx print load failures,
 * which have no suite; the wrapper's generic error when there is nothing else.
 */
function fileErrors(
  stream: FileStream,
  reported: readonly Reported[],
  wrapper: TestEvent | undefined,
  paths: WorktreePaths,
): CheckError[] {
  const stderr = stream.events
    .filter((e) => e.type === "test:stderr")
    .map((e) => e.data.message ?? "")
    .join("");
  const errors = [
    ...reported
      .filter((r) => r.suite && ownFailure(r.event))
      .map((r) => toCheckError(r.event.data.details?.error, paths)),
    stderrError(stderr, paths),
  ].filter((e): e is CheckError => e !== null);
  return errors.length > 0 ? errors : [toCheckError(wrapper?.data.details?.error, paths)];
}
