import type {
  CheckError,
  CheckRunResult,
  TestCheckId,
  TestFileRef,
} from "../../../../../src/core/types/index.js";
import type { Case, RowsInput } from "../../case.js";

/*
 * The rows a run stores (011-35's golden reports, `golden.mjs`), with the
 * history the rule names: 9->10's skip rows (007-23) and 11->12's label of an
 * error after the tests ran (011-19).
 */

const testFile: TestFileRef = { project: "app", path: "test/a.test.ts" };
const test = (name: string): TestCheckId => ({
  kind: "test",
  project: testFile.project,
  testPath: testFile.path,
  fullName: name,
});
const error = (message: string): CheckError => ({
  name: "Error",
  message,
  stack: `Error: ${message}\n    at test/a.test.ts:3:9`,
  location: { path: testFile.path, line: 3, column: 9 },
  diff: null,
});
const pass = (name: string): CheckRunResult => ({
  check: test(name),
  outcome: "pass",
  durationMs: 5,
  location: null,
  errors: [],
});
const fail = (name: string): CheckRunResult => ({
  check: test(name),
  outcome: "fail",
  durationMs: 5,
  location: { path: testFile.path, line: 3, column: 9 },
  errors: [error("boom")],
});

const rows = (name: string, why: string, input: Omit<RowsInput, "testFile">): Case => ({
  kind: "rows",
  name,
  why,
  input: { testFile, ...input },
});

export const GOLDEN_ROWS: readonly Case[] = [
  rows("plain rows", "011-35's golden rows: a pass and a fail", {
    report: { results: [pass("adds"), fail("subtracts")] },
    previousChecks: [],
  }),
  rows("a load error", "D4, D8: a file-level error fails each check of the previous key", {
    report: { fileErrors: [{ testFile, errors: [error("cannot import")] }] },
    previousChecks: [test("adds"), test("subtracts")],
  }),
  rows(
    "an error after the tests ran",
    "11->12 (011-19): the file-level check fails, the tests that passed keep their pass",
    {
      report: {
        results: [pass("adds")],
        fileErrors: [{ testFile, errors: [error("afterAll threw")] }],
      },
      previousChecks: [test("adds")],
    },
  ),
  rows("a module skip", "9->10 (007-23): a module-level skip stores skip for each known check", {
    report: { results: [], skippedFiles: [{ testFile, reason: "skipped by the module" }] },
    previousChecks: [test("adds"), test("subtracts")],
  }),
  rows(
    "a module skip with no known check",
    "007-23: the runner's results stand when the previous key held no check",
    {
      report: {
        results: [pass("adds")],
        skippedFiles: [{ testFile, reason: "skipped by the module" }],
      },
      previousChecks: [],
    },
  ),
  rows(
    "the time outside the tests",
    "review wave 4.5, N1: the file-level check carries the file's time outside its tests",
    {
      report: {
        results: [pass("adds"), pass("subtracts")],
        fileDurations: [{ testFile, durationMs: 40 }],
      },
      previousChecks: [],
    },
  ),
];
