import { describe, expect, it } from "vitest";
import { recordsForFile } from "../../src/core/scheduler/records.js";
import { describeFailure } from "../../src/core/state/index.js";
import type {
  CheckError,
  CheckId,
  Provenance,
  RunReport,
  TestCheckId,
  TestFileRef,
} from "../../src/core/types/index.js";

const file: TestFileRef = { project: "", path: "test/a.test.ts" };
const other: TestFileRef = { project: "", path: "test/b.test.ts" };
const test = (fullName: string, ref = file): TestCheckId => ({
  kind: "test",
  project: ref.project,
  testPath: ref.path,
  fullName,
});
const provenance: Provenance = {
  worktreeId: "wt",
  revision: 3,
  commit: "abc",
  dirty: true,
  runId: "run-1",
  recordedAt: 100,
};
const importError: CheckError = {
  name: "Error",
  message: "Cannot find module '../src/gone'\nmore detail",
  stack: null,
  location: { path: "test/a.test.ts", line: 2, column: 1 },
  diff: null,
};

const report = (patch: Partial<RunReport>): RunReport => ({
  end: "completed",
  durationMs: 10,
  completedFiles: [file, other],
  results: [],
  fileErrors: [],
  failure: null,
  ...patch,
});

describe("recordsForFile", () => {
  /*
   * Row 013-03 (gh-62): the file-level check records the whole module's
   * time, its tests included, so `why` and its durations show what the file
   * costs; it was the time outside its tests (review wave 4.5, N1), 3.5 s on
   * a 112 s file.
   */
  it("puts the whole module's time on the file-level check (013-03)", () => {
    const fileCheck = { kind: "file", project: "", testPath: file.path };
    const records = recordsForFile({
      ref: file,
      key: "k1",
      report: report({
        results: [
          { check: test("adds"), outcome: "pass", durationMs: 2, location: null, errors: [] },
          { check: test("subs"), outcome: "pass", durationMs: 3, location: null, errors: [] },
        ],
        fileDurations: [
          { testFile: file, durationMs: 305 },
          { testFile: other, durationMs: 9 },
        ],
      }),
      previousChecks: [],
      provenance,
      describe: describeFailure,
    });
    expect(records.map((r) => [r.check, r.durationMs])).toEqual([
      [test("adds"), 2],
      [test("subs"), 3],
      [fileCheck, 305],
    ]);
  });

  it("keeps the file-level check at 0 ms without a module duration", () => {
    const records = recordsForFile({
      ref: file,
      key: "k1",
      report: report({
        results: [
          { check: test("adds"), outcome: "pass", durationMs: 2, location: null, errors: [] },
        ],
      }),
      previousChecks: [],
      provenance,
      describe: describeFailure,
    });
    expect(records.at(-1)?.durationMs).toBe(0);
  });

  it("maps this file's results under the key and leaves other files out", () => {
    const records = recordsForFile({
      ref: file,
      key: "k1",
      report: report({
        results: [
          { check: test("adds"), outcome: "pass", durationMs: 2, location: null, errors: [] },
          {
            check: test("fails"),
            outcome: "fail",
            durationMs: 3,
            location: null,
            errors: [importError],
          },
          { check: test("x", other), outcome: "pass", durationMs: 1, location: null, errors: [] },
        ],
      }),
      previousChecks: [],
      provenance,
      describe: describeFailure,
    });
    expect(records.map((r) => [r.check, r.key, r.outcome, r.summary])).toEqual([
      [test("adds"), "k1", "pass", null],
      [test("fails"), "k1", "fail", "Cannot find module '../src/gone'"],
      // S1: the file loaded, so its file-level check passes.
      [{ kind: "file", project: "", testPath: file.path }, "k1", "pass", null],
    ]);
    expect(records[1]?.fingerprint).toBe(
      "Error: Cannot find module '../src/gone' @ test/a.test.ts:2:1",
    );
    expect(records[0]?.provenance).toEqual(provenance);
  });

  it("expands a file-level error to every check of the previous key plus the file check (D4)", () => {
    const previousChecks: CheckId[] = [
      test("adds"),
      test("subtracts"),
      { kind: "file", project: "", testPath: file.path },
    ];
    const records = recordsForFile({
      ref: file,
      key: "k2",
      report: report({ fileErrors: [{ testFile: file, errors: [importError] }] }),
      previousChecks,
      provenance,
      describe: describeFailure,
    });
    expect(records.map((r) => [r.check, r.outcome])).toEqual([
      [test("adds"), "fail"],
      [test("subtracts"), "fail"],
      [{ kind: "file", project: "", testPath: file.path }, "fail"],
    ]);
    expect(records.every((r) => r.key === "k2")).toBe(true);
    // Task 001-361: no test of the file reported, so the error is a load error.
    for (const r of records) expect(r.errors).toEqual([{ ...importError, phase: "load" }]);
    expect(records[0]?.location).toEqual(importError.location);
  });

  it("keeps results of checks that ran when an unhandled error is attributed to the file", () => {
    const records = recordsForFile({
      ref: file,
      key: "k3",
      report: report({
        results: [
          { check: test("adds"), outcome: "pass", durationMs: 2, location: null, errors: [] },
        ],
        fileErrors: [{ testFile: file, errors: [importError] }],
      }),
      previousChecks: [test("adds")],
      provenance,
      describe: describeFailure,
    });
    expect(records.map((r) => [r.check.kind, r.outcome])).toEqual([
      ["test", "pass"],
      ["file", "fail"],
    ]);
  });

  it("puts the whole module's time on a failing file-level check too (013-03)", () => {
    const records = recordsForFile({
      ref: file,
      key: "k3",
      report: report({
        results: [
          { check: test("adds"), outcome: "pass", durationMs: 2, location: null, errors: [] },
        ],
        fileErrors: [{ testFile: file, errors: [importError] }],
        fileDurations: [{ testFile: file, durationMs: 40 }],
      }),
      previousChecks: [test("adds")],
      provenance,
      describe: describeFailure,
    });
    expect(records.map((r) => [r.check.kind, r.outcome, r.durationMs])).toEqual([
      ["test", "pass", 2],
      ["file", "fail", 40],
    ]);
  });

  it("words a file-level error after the file's tests reported as one after its tests ran (task 011-19)", () => {
    const hookError: CheckError = { ...importError, message: "fetch failed" };
    const records = recordsForFile({
      ref: file,
      key: "k5",
      report: report({
        results: [
          { check: test("adds"), outcome: "skip", durationMs: 0, location: null, errors: [] },
        ],
        fileErrors: [{ testFile: file, errors: [hookError] }],
      }),
      previousChecks: [test("adds")],
      provenance,
      describe: describeFailure,
    });
    const fileLevel = records.find((r) => r.check.kind === "file");
    expect(fileLevel?.errors).toEqual([{ ...hookError, phase: "after-tests" }]);
    expect(fileLevel?.summary).toBe("error after its tests ran: fetch failed");
  });

  it("records a pass for the file-level check of a file that loaded with no tests (S1)", () => {
    const records = recordsForFile({
      ref: file,
      key: "k4",
      report: report({}),
      previousChecks: [{ kind: "file", project: "", testPath: file.path }],
      provenance,
      describe: describeFailure,
    });
    expect(records.map((r) => [r.check, r.outcome, r.durationMs, r.errors])).toEqual([
      [{ kind: "file", project: "", testPath: file.path }, "pass", 0, []],
    ]);
  });
});
