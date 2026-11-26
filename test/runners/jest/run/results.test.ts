import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { WorktreePaths } from "../../../../src/core/fs/worktree-paths.js";
import type { AbsolutePath, RelativePath } from "../../../../src/core/types/common.js";
import type { TestFileRef } from "../../../../src/core/types/keys.js";
import {
  type FileResultEvent,
  type JestCase,
  parseJestEvents,
  readEvents,
} from "../../../../src/runners/jest/run/events.js";
import {
  type BatchOutcome,
  checkNames,
  ending,
  readJestBatch,
  toCheckError,
} from "../../../../src/runners/jest/run/results.js";

/* Spec 028 D5 (row 028-03): mapping the reporter's records to checks, without running Jest. */

const ROOT = "/work/tree" as AbsolutePath;
const paths = new WorktreePaths(ROOT);
const ref = (path: string): TestFileRef => ({ project: "web", path: path as RelativePath });
const A = ref("test/a.test.js");
const B = ref("test/b.test.js");

function testCase(title: string, extra: Partial<JestCase> = {}): JestCase {
  return {
    title,
    ancestorTitles: [],
    fullName: title,
    status: "passed",
    duration: 3,
    location: { line: 1, column: 1 },
    failureMessages: [],
    failureDetails: [],
    ...extra,
  };
}

function fileResult(file: TestFileRef, extra: Partial<FileResultEvent> = {}): FileResultEvent {
  return {
    type: "fileResult",
    testFilePath: `${ROOT}/${file.path}`,
    durationMs: 40,
    testResults: [],
    testExecError: null,
    failureMessage: null,
    snapshot: {
      added: 0,
      fileDeleted: false,
      matched: 0,
      unchecked: 0,
      uncheckedKeys: [],
      unmatched: 0,
      updated: 0,
    },
    loaded: [],
    ...extra,
  };
}

describe("checkNames (spec 028 D5.2, Vitest's rule)", () => {
  it("joins ancestors and title, and suffixes duplicates by line, then ordinal", () => {
    const at = (line: number) => ({ line, column: 3 });
    expect(
      checkNames([
        { title: "dup", ancestorTitles: ["outer", "inner"], location: at(2) },
        { title: "dup", ancestorTitles: ["outer", "inner"], location: at(3) },
        { title: "each 1", ancestorTitles: [], location: at(4) },
        { title: "each 1", ancestorTitles: [], location: at(4) },
        { title: "each 1", ancestorTitles: [], location: at(4) },
        { title: "x", ancestorTitles: [], location: null },
        { title: "x", ancestorTitles: [], location: null },
      ]),
    ).toEqual([
      "outer > inner > dup",
      "outer > inner > dup (line 3)",
      "each 1",
      "each 1 (line 4)",
      "each 1 (line 4, 2)",
      "x",
      "x (line ?)",
    ]);
  });
});

describe("readJestBatch", () => {
  it("completes only files with a whole fileResult line (Kit K8)", () => {
    const text = [
      JSON.stringify({ type: "fileStart", testFilePath: `${ROOT}/${A.path}` }),
      JSON.stringify(fileResult(A, { testResults: [testCase("a")] })),
      JSON.stringify({ type: "fileStart", testFilePath: `${ROOT}/${B.path}` }),
      JSON.stringify({ type: "case", testFilePath: `${ROOT}/${B.path}`, ...testCase("b") }),
      JSON.stringify(fileResult(B)).slice(0, 30),
    ].join("\n");
    const reports = readJestBatch(parseJestEvents(text), [A, B], paths);
    expect(reports.map((r) => r.testFile)).toEqual([A]);
    expect(reports[0]?.results.map((r) => r.check.fullName)).toEqual(["a"]);
  });

  it("ignores a file outside the batch and a second fileResult of one file", () => {
    const other = fileResult(ref("test/other.test.js"));
    const again = fileResult(A, { testResults: [testCase("late")] });
    const reports = readJestBatch([other, fileResult(A), again], [A], paths);
    expect(reports).toHaveLength(1);
    expect(reports[0]?.results).toEqual([]);
  });

  it("maps statuses: pending and todo skip, an unknown status gives no result", () => {
    const statuses = ["passed", "failed", "pending", "todo", "disabled", "focused", "constructor"];
    const cases = statuses.map((status) => testCase(status, { status }));
    const [report] = readJestBatch([fileResult(A, { testResults: cases })], [A], paths);
    expect(report?.results.map((r) => [r.check.fullName, r.outcome])).toEqual([
      ["passed", "pass"],
      ["failed", "fail"],
      ["pending", "skip"],
      ["todo", "skip"],
      ["disabled", "skip"],
    ]);
    expect(report?.results[0]).toMatchObject({
      check: { kind: "test", project: "web", testPath: A.path },
      durationMs: 3,
      location: { path: A.path, line: 1, column: 1 },
      errors: [],
    });
  });

  it("marks a timeout's error stage and keeps a matcher's evidence", () => {
    const failed = testCase("slow", {
      status: "failed",
      failureMessages: [
        'Error: thrown: "Exceeded timeout of 50 ms for a test."\n    at Object.test (/work/tree/test/a.test.js:2:1)',
        "Error: expect(received).toBe(expected)\n\nExpected: 2\n    at Object.toBe (/work/tree/test/a.test.js:3:5)",
      ],
      failureDetails: [
        { message: 'thrown: "Exceeded timeout of 50 ms for a test."' },
        { matcher: true },
      ],
    });
    const [report] = readJestBatch([fileResult(A, { testResults: [failed] })], [A], paths);
    const [timeout, assertion] = report?.results[0]?.errors ?? [];
    expect(timeout).toMatchObject({ stage: "timeout", location: { path: A.path, line: 2 } });
    expect(assertion).toMatchObject({
      name: "Error",
      message: "expect(received).toBe(expected)\n\nExpected: 2",
      assertionEvidence: true,
    });
    expect(assertion?.stage).toBeUndefined();
  });

  it("reports testExecError as a load error, or after-tests when tests reported", () => {
    const exec = {
      name: "Error",
      message: "boom",
      stack: "Error: boom\n    at x (/work/tree/test/a.test.js:1:7)",
    };
    const [load] = readJestBatch([fileResult(A, { testExecError: exec })], [A], paths);
    expect(load?.fileError).toEqual({
      testFile: A,
      errors: [
        {
          name: "Error",
          message: "boom",
          stack: "Error: boom\n    at x (test/a.test.js:1:7)",
          location: { path: A.path, line: 1, column: 7 },
          diff: null,
          phase: "load",
        },
      ],
    });
    const withTests = fileResult(A, { testExecError: exec, testResults: [testCase("t")] });
    expect(readJestBatch([withTests], [A], paths)[0]?.fileError?.errors[0]?.phase).toBe(
      "after-tests",
    );
  });

  it("reports obsolete snapshot entries as a file error", () => {
    const snapshot = { ...fileResult(A).snapshot, unchecked: 2, uncheckedKeys: ["old 1", "old 2"] };
    const [report] = readJestBatch([fileResult(A, { snapshot })], [A], paths);
    expect(report?.fileError?.errors).toEqual([
      expect.objectContaining({
        name: "ObsoleteSnapshot",
        message: expect.stringContaining(
          '2 obsolete snapshot entries that no test checks: "old 1", "old 2"',
        ),
        phase: "after-tests",
      }),
    ]);
  });

  it("keeps the project modules a file loaded, the file itself among them", () => {
    const loaded = [`${ROOT}/src/sum.js`, `${ROOT}/node_modules/x/index.js`, "/elsewhere/y.js"];
    const [report] = readJestBatch([fileResult(A, { loaded })], [A], paths);
    expect(report?.loaded).toEqual(["src/sum.js", "test/a.test.js"]);
    expect(readJestBatch([fileResult(A)], [A], paths)[0]?.loaded).toEqual([]);
  });
});

describe("toCheckError", () => {
  it("strips ANSI codes and worktree paths, and takes the first frame outside node_modules", () => {
    const text = [
      "\u001b[31mTypeError: cannot read /work/tree/src/sum.js\u001b[39m",
      "    at fn (/work/tree/node_modules/lib/index.js:9:9)",
      "    at Object.<anonymous> (file:///work/tree/src/sum.js:4:2)",
    ].join("\n");
    expect(toCheckError(text, { code: "ERR_X" }, paths)).toEqual({
      name: "TypeError",
      message: "cannot read src/sum.js",
      stack: [
        "TypeError: cannot read src/sum.js",
        "    at fn (node_modules/lib/index.js:9:9)",
        "    at Object.<anonymous> (src/sum.js:4:2)",
      ].join("\n"),
      location: { path: "src/sum.js", line: 4, column: 2 },
      diff: null,
      code: "ERR_X",
    });
  });
});

describe("ending", () => {
  const logDir = mkdtempSync(join(tmpdir(), "squeal-jest-ending-")) as AbsolutePath;
  afterAll(() => rmSync(logDir, { recursive: true, force: true }));
  const options = { files: [A, B], timeoutMs: 500, logDir: "/nowhere" as AbsolutePath, paths };
  const exit = { code: 1, signal: null, error: null };
  const ran = { expired: false, cancelled: false };
  const passed = (file: TestFileRef) =>
    readJestBatch([fileResult(file, { testResults: [testCase("ok")] })], [file], paths);
  const failed = (file: TestFileRef) =>
    readJestBatch(
      [fileResult(file, { testResults: [testCase("no", { status: "failed" })] })],
      [file],
      paths,
    );
  const batch = (index: number, file: TestFileRef, extra: Partial<BatchOutcome> = {}) => ({
    index,
    files: [file],
    exit: { code: 0, signal: null, error: null },
    cut: null,
    reports: passed(file),
    ...extra,
  });

  it("names the unfinished files and their exit; crashed when none completed", () => {
    const some = { index: 0, files: [A, B], exit, cut: null, reports: passed(A) };
    expect(ending([some], ran, options)).toEqual({
      end: "completed",
      failure: "jest ended without a result for test/b.test.js (exit code 1)",
      done: passed(A),
    });
    const none = ending(
      [{ index: 0, files: [A, B], exit: null, cut: null, reports: [] }],
      ran,
      options,
    );
    expect(none).toEqual({
      end: "crashed",
      failure: "jest ended without a result for test/a.test.js, test/b.test.js (not started)",
      done: [],
    });
  });

  it("is timed-out on the deadline", () => {
    const some = { index: 0, files: [A, B], exit, cut: 10, reports: passed(A) };
    expect(ending([some], { expired: true, cancelled: false }, options)).toEqual({
      end: "timed-out",
      failure: "deadline of 500 ms passed with 1 of 2 test files unfinished",
      done: passed(A),
    });
  });

  it("keeps an exit 1 that a failed test or a file error explains (review 0.1.643 B3)", () => {
    const loadError = readJestBatch(
      [fileResult(B, { testExecError: { message: "boom", stack: null } })],
      [B],
      paths,
    );
    const batches = [
      batch(0, A, { exit, reports: failed(A) }),
      batch(1, B, { exit, reports: loadError }),
    ];
    expect(ending(batches, ran, options)).toEqual({
      end: "completed",
      failure: null,
      done: [...failed(A), ...loadError],
    });
  });

  it("withholds a batch that ended abnormally after its last file, quoting its stderr", () => {
    writeFileSync(
      join(logDir, "stderr-0.log"),
      `\u001b[31mError: Jest: Got error running globalTeardown - ${ROOT}/teardown.cjs, reason: PROOF\u001b[39m\n    at hook (${ROOT}/node_modules/x.js:1:1)\n`,
    );
    const where = { ...options, logDir };
    const teardown = ending([batch(0, A, { exit }), batch(1, B)], ran, where);
    expect(teardown).toEqual({
      end: "completed",
      failure: `jest exited abnormally after test/a.test.js completed (exit code 1: Error: Jest: Got error running globalTeardown - teardown.cjs, reason: PROOF; log ${logDir}/stderr-0.log)`,
      done: passed(B),
    });
    // Jest's words for the teardown withhold the batch though a failed test explains exit 1.
    expect(ending([batch(0, A, { exit, reports: failed(A) })], ran, where).end).toBe("crashed");
    for (const how of [
      { code: 2, signal: null, error: null },
      { code: null, signal: "SIGKILL" as const, error: null },
      { code: null, signal: null, error: "ENOENT" },
    ]) {
      const one = ending([batch(1, B, { exit: how, reports: failed(B) })], ran, options);
      expect(one.end).toBe("crashed");
      expect(one.done).toEqual([]);
      expect(one.failure).toMatch(/^jest exited abnormally after test\/b\.test\.js completed \(/);
    }
  });

  it("never withholds a batch Squeal signalled, and reports no failure on a stop (Kit K8)", () => {
    const signalled = { code: null, signal: "SIGTERM" as const, error: null };
    const stopped = [
      batch(0, A, { exit: signalled, cut: 100 }),
      batch(1, B, { exit: { code: 2, signal: null, error: null } }),
    ];
    expect(ending(stopped, { expired: false, cancelled: true }, options)).toEqual({
      end: "completed",
      failure: null,
      done: passed(A),
    });
  });
});

describe("readEvents", () => {
  const dir = mkdtempSync(join(tmpdir(), "squeal-jest-events-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("reads only the bytes written before the signal", () => {
    const path = join(dir, "events.jsonl");
    writeFileSync(path, "first\nsecond\n");
    expect(readEvents(path, 6)).toBe("first\n");
    expect(readEvents(path, null)).toBe("first\nsecond\n");
    expect(readEvents(join(dir, "missing"), null)).toBe("");
  });
});

describe("squeal-reporter.cjs (spec 028 D5.1)", () => {
  const dir = mkdtempSync(join(tmpdir(), "squeal-jest-reporter-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const require = createRequire(import.meta.url);
  const Reporter =
    require("../../../../src/runners/jest/runtime/squeal-reporter.cjs") as new () => {
      onTestFileStart(test: object): void;
      onTestFileResult(test: object, result: object): void;
    };

  it("writes a fileResult with what the runtime observer loaded, and takes the entry", () => {
    const events = join(dir, "events.jsonl");
    const previous = process.env.SQUEAL_JEST_EVENTS;
    process.env.SQUEAL_JEST_EVENTS = events;
    const key = Symbol.for("squeal.jestLoaded");
    const store = globalThis as unknown as Record<symbol, Map<string, Set<string>>>;
    store[key] = new Map([["/w/a.test.js", new Set(["/w/b.js", "/w/a.test.js"])]]);
    try {
      const reporter = new Reporter();
      reporter.onTestFileStart({ path: "/w/a.test.js" });
      const cycle: Record<string, unknown> = { name: "Error", message: "m" };
      cycle.self = cycle;
      reporter.onTestFileResult(
        { path: "/w/a.test.js" },
        {
          testFilePath: "/w/a.test.js",
          perfStats: { start: 10, end: 25 },
          testResults: [{ ...testCase("t"), failureDetails: [cycle] }],
          testExecError: null,
          snapshot: { unchecked: 1, uncheckedKeys: ["k 1"] },
        },
      );
      const [start, result] = readFileSync(events, "utf8")
        .trim()
        .split("\n")
        .map((l) => JSON.parse(l));
      expect(start).toEqual({ type: "fileStart", testFilePath: "/w/a.test.js" });
      expect(result).toMatchObject({
        type: "fileResult",
        durationMs: 15,
        testExecError: null,
        loaded: ["/w/a.test.js", "/w/b.js"],
        snapshot: { unchecked: 1, uncheckedKeys: ["k 1"], unmatched: 0 },
      });
      expect(result.testResults[0].failureDetails).toEqual([
        { name: "Error", message: "m", stack: null, code: null, matcher: false },
      ]);
      expect(store[key]?.has("/w/a.test.js")).toBe(false);
    } finally {
      if (previous === undefined) delete process.env.SQUEAL_JEST_EVENTS;
      else process.env.SQUEAL_JEST_EVENTS = previous;
      delete store[key];
    }
  });
});
