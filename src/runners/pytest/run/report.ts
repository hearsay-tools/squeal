import { join, sep } from "node:path";
import type { WorktreePaths } from "../../../core/fs/worktree-paths.js";
import type {
  AbsolutePath,
  CheckError,
  CheckRunResult,
  FileLevelError,
  FocusedCount,
  RunOutcome,
  SourceLocation,
  TestFileRef,
} from "../../../core/types/index.js";
import { holdsCheckText } from "../../focus.js";
import { scrubBasetemp } from "./basetemp.js";
import type { CollectedItem, PhaseEvent, PytestEvent } from "./events.js";

/** A test file of a batch: its ref and its real absolute path, as the plugin writes paths. */
export interface BatchFile {
  readonly testFile: TestFileRef;
  readonly real: AbsolutePath;
  /** A focused run's texts for the file (`RunOptions.checks`); absent: it runs whole. */
  readonly texts?: readonly string[];
}

/** What one file's part of a batch's event stream says. */
export interface PytestFileReport {
  readonly testFile: TestFileRef;
  /**
   * Collection finished and every item the file collected has its teardown
   * report (spec 007 D6). A killed or dead process keeps the files that got
   * that far: D6's deadline keeps completed files, and a file's module
   * fixtures end in its last item's teardown.
   */
  readonly completed: boolean;
  readonly results: readonly CheckRunResult[];
  readonly fileError: FileLevelError | null;
  /** A module-level skip's reason: the file's known checks are skipped (D6). */
  readonly skipped: string | null;
  /** The sum of its items' phase durations (D6). */
  readonly durationMs: number;
  /** With `texts`: what they selected, as the plugin counted what the file collected. */
  readonly focused?: FocusedCount;
}

export interface BatchReport {
  readonly files: readonly PytestFileReport[];
  /** The plugin wrote its session record. */
  readonly session: boolean;
  /** Flags the plugin refused in `pytest_configure`. */
  readonly refused: readonly string[];
  /** Node ids holding a memory address, which change every run (D3). */
  readonly addressIds: readonly string[];
}

/** `scrubBasetemp` on the batch's basetemp, given the test's node name if any. */
type Scrub = (text: string, name?: string) => string;

/**
 * Maps one batch's events to per-file results (spec 007 D3, D6). Results
 * come only from the event file; the exit code is the caller's to judge.
 * `rootdir` is pytest's, against which `location` paths are written;
 * `basetemp`, the batch's, is written as `scrubBasetemp` does (task 007-37),
 * each test's with its own node name (task 007-43). A file with `texts`
 * reports only the checks whose full name holds one (row 011-135), as the
 * plugin deselected the others.
 */
export function readBatch(
  events: readonly PytestEvent[],
  files: readonly BatchFile[],
  rootdir: AbsolutePath,
  paths: WorktreePaths,
  basetemp: AbsolutePath | null = null,
): BatchReport {
  const scrub: Scrub = (text, name) =>
    basetemp === null ? text : scrubBasetemp(text, basetemp, name);
  const collected = events.find((e) => e.type === "collected");
  const phases = new Map<string, PhaseEvent[]>();
  for (const e of events) {
    if (e.type === "phase") phases.set(e.nodeid, [...(phases.get(e.nodeid) ?? []), e]);
  }
  const collects = events.flatMap((e) => (e.type === "collect" ? [e] : []));
  const items = collected?.items ?? [];
  const counts = events.find((e) => e.type === "focused")?.files ?? {};

  const reports = files.map((file): PytestFileReport => {
    const own = items.filter((item) => item.path === file.real);
    const failed = collects.find(
      (c) =>
        c.outcome === "failed" &&
        (c.path === file.real || (own.length === 0 && under(file.real, c.path))),
    );
    const skip = collects.find((c) => c.outcome === "skipped" && c.path === file.real);
    const done = own.every((item) => phases.get(item.nodeid)?.some((p) => p.when === "teardown"));
    const { texts } = file;
    const results = done
      ? own
          .map((item) => joinPhases(item, file.testFile, phases, rootdir, paths, scrub))
          .filter((r) => texts === undefined || holdsCheckText(r.check.fullName, texts))
      : [];
    return {
      testFile: file.testFile,
      completed: collected !== undefined && done,
      results,
      fileError:
        failed === undefined
          ? null
          : { testFile: file.testFile, errors: [collectionError(failed.longrepr, paths, scrub)] },
      skipped: skip === undefined ? null : skipReason(skip.longrepr),
      durationMs: Math.round(results.reduce((sum, r) => sum + r.durationMs, 0)),
      ...(texts === undefined
        ? {}
        : {
            focused: {
              testFile: file.testFile,
              collected: counts[file.real]?.collected ?? null,
              matched: results.length,
            },
          }),
    };
  });
  return {
    files: reports,
    session: events.some((e) => e.type === "session"),
    refused: events.flatMap((e) => (e.type === "refused" ? e.flags : [])),
    addressIds: items.map((i) => i.nodeid).filter((id) => /0x[0-9a-f]{4,}/i.test(id)),
  };
}

/**
 * D3: "A test's outcome joins its three phases: a failing setup or teardown
 * is `fail` with that phase's error, even after a passing call; `skip` is
 * `skip`; xfail is `skip` [...]; non-strict xpass is `pass`; strict xpass is
 * `fail`." pytest reports xfail as a skipped call with `wasxfail`, a
 * non-strict xpass as a passed call with it, and a strict xpass as a failed
 * call (runner-api F2), so the call's own outcome already says it.
 */
function joinPhases(
  item: CollectedItem,
  testFile: TestFileRef,
  phases: ReadonlyMap<string, readonly PhaseEvent[]>,
  rootdir: AbsolutePath,
  paths: WorktreePaths,
  scrubAll: Scrub,
): CheckRunResult {
  // Task 007-43: only this test's own `tmp_path` counter is replaced.
  const scrub: Scrub = (text) => scrubAll(text, item.name);
  const own = phases.get(item.nodeid) ?? [];
  const phase = (when: PhaseEvent["when"]) => own.find((p) => p.when === when);
  const setup = phase("setup");
  const call = phase("call");
  const teardown = phase("teardown");
  const errors: CheckError[] = [];
  let outcome: RunOutcome = "pass";
  if (setup?.outcome === "failed") {
    outcome = "fail";
    errors.push(phaseError(setup, paths, scrub));
  } else if (setup?.outcome === "skipped" || call?.outcome === "skipped") outcome = "skip";
  else if (call?.outcome === "failed") {
    outcome = "fail";
    errors.push(phaseError(call, paths, scrub));
  }
  if (teardown?.outcome === "failed") {
    outcome = "fail";
    errors.push(phaseError(teardown, paths, scrub));
  }
  const first = setup ?? call ?? teardown;
  return {
    check: {
      kind: "test",
      project: testFile.project,
      testPath: testFile.path,
      fullName: item.nodeid.slice(item.nodeid.indexOf("::") + 2),
    },
    outcome,
    durationMs: own.reduce((sum, p) => sum + p.duration * 1000, 0),
    location: first === undefined ? null : checkLocation(first, testFile, rootdir, paths),
    errors,
  };
}

/** D3: "A check's location is the test's line from `report.location` (zero-based, made one-based)". */
function checkLocation(
  phase: PhaseEvent,
  testFile: TestFileRef,
  rootdir: AbsolutePath,
  paths: WorktreePaths,
): SourceLocation | null {
  const { path, line } = phase.location;
  if (line === null) return null;
  const relative = paths.toRelative(join(rootdir, path)) ?? testFile.path;
  return { path: relative, line: line + 1, column: 1 };
}

/** D3: "an error's location is `reprcrash` when present, which may name a helper or fixture line." */
function phaseError(phase: PhaseEvent, paths: WorktreePaths, scrub: Scrub): CheckError {
  const text = scrub(phase.longrepr ?? "");
  const { name, message } = splitException(
    phase.crash === null ? (lastErrorLine(text) ?? text) : scrub(phase.crash.message),
  );
  // A long report ends `<path>:<line>: <type>`; reprcrash of an assertion holds no type.
  const type = /:\d+: ([A-Za-z_][\w.]*)$/.exec(text.trimEnd())?.[1];
  return {
    name: name === "Error" && type !== undefined ? type : name,
    message: phase.when === "call" ? message : `[${phase.when}] ${message}`,
    stack: text === "" ? null : paths.relativizeText(text),
    location: phase.crash === null ? null : paths.location(phase.crash.path, phase.crash.line, 1),
    diff: null,
  };
}

/** D6: "A failed collection report is a `FileLevelError` with its traceback". */
function collectionError(longrepr: string | null, paths: WorktreePaths, scrub: Scrub): CheckError {
  // A collection error has no test, so only the basetemp is replaced.
  const text = scrub(longrepr ?? "collection failed");
  const { name, message } = splitException(lastErrorLine(text) ?? text.split("\n")[0] ?? text);
  return { name, message, stack: paths.relativizeText(text), location: null, diff: null };
}

/** pytest's failure lines start with `E   `; the last one is the exception. */
function lastErrorLine(text: string): string | null {
  const lines = text.split("\n").filter((l) => l.startsWith("E   "));
  const last = lines.at(-1);
  return last === undefined ? null : last.slice(4).trim();
}

/** `ValueError: msg` as name and message; text without an exception name is all message. */
function splitException(text: string): { name: string; message: string } {
  const match = /^([A-Za-z_][\w.]*): ([\s\S]*)$/.exec(text);
  return match === null
    ? { name: "Error", message: text }
    : { name: match[1] as string, message: match[2] as string };
}

function skipReason(longrepr: string | null): string {
  return longrepr ?? "skipped";
}

function under(file: string, dir: string): boolean {
  return file.startsWith(dir.endsWith(sep) ? dir : `${dir}${sep}`);
}
