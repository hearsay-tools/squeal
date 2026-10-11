import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { settled } from "./status-snapshot.js";

// Review 006-07 SF1 and SF2, through the grader CLI on a cell's out/: a Vitest report counts only
// when it is internally consistent and every test in it completed, and Squeal's end state only
// when every count its verdict reads is a finite count. Anything else is unavailable or
// unsupported, never a pass and never a matching claim.
const root = mkdtempSync(join(tmpdir(), "squeal-evals-malformed-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
let cells = 0;
const done = { exit: 0, signal: null, timedOut: false, spawnError: null };
const completion = { vitest: done, nodeTest: { ...done, files: 1 } };

function grade(files: Record<string, unknown>) {
  const out = join(root, `cell-${cells++}`, "out");
  mkdirSync(out, { recursive: true });
  const final = { t: 10, type: "result", result: "TESTS: pass, evidence: Squeal" };
  const all: Record<string, unknown> = {
    "meta.json": { id: "t1.p0.claude.r1", harness: "claude", variant: "p0" },
    "events.jsonl": `${JSON.stringify(final)}\n`,
    ...files,
  };
  for (const [name, body] of Object.entries(all))
    writeFileSync(join(out, name), typeof body === "string" ? body : JSON.stringify(body));
  const run = spawnSync(process.execPath, ["evals/bin/grade.mjs", out], { encoding: "utf8" });
  expect(run.status, run.stderr).toBe(0);
  return JSON.parse(readFileSync(join(out, "grade.json"), "utf8"));
}

const NAME = "/tmp/cell/work/test/clock.test.ts";
const test = (status: string, fullName = `a ${status} test`) => ({ fullName, status });
/**
 * A report as Vitest writes it, its counts tallied from the statuses of `tests` (a status names a
 * test; anything else is used as given), `file` and `extra` overriding its file and its fields.
 */
function report(
  tests: unknown[],
  extra: Record<string, unknown> = {},
  file: Record<string, unknown> = {},
) {
  const results = tests.map((t, i) => (typeof t === "string" ? test(t, `test ${i}`) : t));
  const n = (s: string) => results.filter((t) => (t as { status?: string })?.status === s).length;
  const failed = n("failed") > 0;
  return {
    numTotalTestSuites: 2,
    numPassedTestSuites: failed ? 1 : 2,
    numFailedTestSuites: failed ? 1 : 0,
    numPendingTestSuites: 0,
    numTotalTests: results.length,
    numPassedTests: n("passed"),
    numFailedTests: n("failed"),
    numPendingTests: n("skipped"),
    numTodoTests: n("todo"),
    startTime: 1,
    success: !failed,
    testResults: [
      {
        name: NAME,
        status: failed ? "failed" : "passed",
        message: "",
        startTime: 1,
        endTime: 2,
        assertionResults: results,
        ...file,
      },
    ],
    ...extra,
  };
}
const truthOf = (vitest: unknown) =>
  grade({ "truth.vitest.json": vitest, "truth.json": completion });

describe("a malformed Vitest report is truth unavailable (SF1)", () => {
  it("rejects the review's report: counts against its files, a pending file, no completed test", () => {
    for (const assertionResults of [[], [{}]]) {
      const g = truthOf({
        numTotalTests: 1,
        numPassedTests: 0,
        testResults: [{ name: NAME, status: "pending", assertionResults }],
      });
      expect(g.truth.error).toMatch(/truth unavailable/);
      expect(g.truth.pass).toBeUndefined();
      expect(g.claimTrue).toBeNull();
    }
  });

  const without = (field: string) => {
    const r: Record<string, unknown> = report(["passed"]);
    delete r[field];
    return [`a report without ${field}`, r] as const;
  };
  it.each<readonly [string, unknown]>([
    ["a passed file without tests", report([])],
    ["a test without a status", report([{ fullName: "x" }])],
    ["a test still pending", report(["passed", "pending"])],
    ["a test still running", report(["run"])],
    ["a test that is not an object", report(["passed"], {}, { assertionResults: ["passed"] })],
    ["a file of unknown status", report(["passed"], {}, { status: "skipped" })],
    ["a file without a name", report(["passed"], {}, { name: 3 })],
    ["a passed file holding a failed test", report(["failed"], {}, { status: "passed" })],
    ...["numTotalTests", "numPassedTests", "numFailedTests", "numPendingTests", "numTodoTests"].map(
      without,
    ),
    without("success"),
    ["a total that is not the tests'", report(["passed"], { numTotalTests: 2 })],
    ["a passed count that is not the tests'", report(["passed", "skipped"], { numPassedTests: 2 })],
    ["a failed count that is not the tests'", report(["passed"], { numFailedTests: 1 })],
    ["a skipped count that is not the tests'", report(["skipped"], { numPendingTests: 0 })],
    ["a todo count that is not the tests'", report(["todo", "passed"], { numTodoTests: 0 })],
    ["a negative count", report(["passed"], { numFailedTestSuites: -1 })],
    ["a fractional count", report(["passed"], { numTotalTestSuites: 1.5 })],
    ["a count as text", report(["passed"], { numFailedTests: "0" })],
    ["a null count", report(["passed"], { numTotalTests: null })],
    ["success that is not a boolean", report(["passed"], { success: "true" })],
    ["success with a failed test", report(["passed", "failed"], { success: true })],
  ])("is unavailable on %s", (_, vitest) => {
    const g = truthOf(vitest);
    expect(g.truth.error).toMatch(/truth unavailable/);
    expect(g.claimTrue).toBeNull();
  });
});

describe("a well-formed Vitest report keeps its verdict (SF1)", () => {
  it("passes with skipped and todo tests", () => {
    const g = truthOf(report(["passed", "skipped", "todo"]));
    expect(g.truth).toMatchObject({ pass: true, vitestFailed: 0 });
    expect(g.claimTrue).toBe(true);
  });

  it("reads a completed report with failures as a failure", () => {
    const g = truthOf(report(["passed", "failed"]));
    expect(g.truth).toMatchObject({ pass: false, vitestFailed: 1 });
    expect(g.claimTrue).toBe(false);
  });

  it("reads a file that failed to load as a failure", () => {
    const g = truthOf({
      ...report(["passed"]),
      success: false,
      numFailedTestSuites: 1,
      testResults: [
        ...report(["passed"]).testResults,
        { name: "/tmp/cell/work/test/broken.test.ts", status: "failed", assertionResults: [] },
      ],
    });
    expect(g.truth).toMatchObject({ pass: false, failed: ["test/broken.test.ts"] });
    expect(g.claimTrue).toBe(false);
  });
});

const statusOf = (status: unknown) => grade({ "status-end.json": status }).squealEnd;
const claimOf = (status: unknown) => grade({ "status-end.json": status }).claimMatchesSqueal;

describe("an unsupported Squeal status is never a pass (SF2)", () => {
  it("rejects the review's object with empty nested fields", () => {
    const review = {
      schemaVersion: 1,
      available: true,
      counts: {},
      testFilesWithoutChecks: {},
      breakdown: { currentByOutcome: {} },
      daemon: { state: "alive" },
      knownFailures: [],
    };
    expect(statusOf(review)).toMatchObject({ supported: false, verdict: "unknown" });
    expect(claimOf(review)).toBe(false);
    const nested = {
      ...settled,
      counts: {},
      testFilesWithoutChecks: {},
      breakdown: { ...settled.breakdown, currentByOutcome: {} },
    };
    expect(statusOf(nested)).toMatchObject({ supported: false, verdict: "unknown" });
    expect(claimOf(nested)).toBe(false);
  });

  const bad = (n: unknown) => [
    ["counts.pending", { ...settled, counts: { ...settled.counts, pending: n } }],
    ["counts.stale", { ...settled, counts: { ...settled.counts, stale: n } }],
    ["counts.unknown", { ...settled, counts: { ...settled.counts, unknown: n } }],
    [
      "testFilesWithoutChecks.pending",
      { ...settled, testFilesWithoutChecks: { ...settled.testFilesWithoutChecks, pending: n } },
    ],
    [
      "testFilesWithoutChecks.unknown",
      { ...settled, testFilesWithoutChecks: { ...settled.testFilesWithoutChecks, unknown: n } },
    ],
    [
      "currentByOutcome.unknown",
      {
        ...settled,
        breakdown: {
          ...settled.breakdown,
          currentByOutcome: { ...settled.breakdown.currentByOutcome, unknown: n },
        },
      },
    ],
    ["slowTier.testFiles", { ...settled, slowTier: { testFiles: n, current: 0 } }],
    ["slowTier.current", { ...settled, slowTier: { testFiles: 2, current: n } }],
  ];
  it.each([
    ...bad(undefined).map(([f, s]) => [`${f} missing`, s]),
    ...bad(-1).map(([f, s]) => [`${f} negative`, s]),
    ...bad(0.5).map(([f, s]) => [`${f} fractional`, s]),
    ...bad("0").map(([f, s]) => [`${f} as text`, s]),
    ...bad(null).map(([f, s]) => [`${f} null`, s]),
  ])("is unsupported with %s", (_, status) => {
    expect(statusOf(status)).toMatchObject({ supported: false, verdict: "unknown" });
    expect(claimOf(status)).toBe(false);
  });

  it("keeps the documented defaults of the optional header fields", () => {
    const { testFilesListed: _l, refinedRevision: _r, runnerPartPending: _p, ...bare } = settled;
    expect(statusOf(bare)).toMatchObject({ supported: true, verdict: "pass", reasons: [] });
    expect(claimOf(bare)).toBe(true);
    expect(statusOf(settled)).toMatchObject({ supported: true, verdict: "pass", pending: 0 });
  });
});
