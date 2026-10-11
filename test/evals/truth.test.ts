import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { type Completion, groundTruthOf, type TruthRecord } from "../../evals/lib/index.mjs";

// Review wave 1, B3: ground truth passes only when both commands completed (a numeric exit, no
// signal, no timeout, no spawn error) and the Vitest report is valid and non-empty. Anything
// else is "truth unavailable", never a pass. The runner writes `out/truth.json` (wave 1.5's
// contract); the 005-07 import has none and keeps its committed grades.

const done = (exit: number | null): Completion => ({
  exit,
  signal: null,
  timedOut: false,
  spawnError: null,
});
const completion = (vitest = done(0), nodeTest = { ...done(0), files: 1 }): TruthRecord => ({
  vitest,
  nodeTest,
});
const report = (failed: string[] = [], extra: Record<string, unknown> = {}) => ({
  success: failed.length === 0,
  numTotalTests: 1 + failed.length,
  numPassedTests: 1,
  numFailedTests: failed.length,
  numPendingTests: 0,
  numTodoTests: 0,
  ...extra,
  testResults: [
    {
      name: "/tmp/cell/work/test/clock.test.ts",
      status: failed.length ? "failed" : "passed",
      assertionResults: [
        { fullName: "due dates moves a Sunday", status: "passed" },
        ...failed.map((fullName) => ({ fullName, status: "failed" })),
      ],
    },
  ],
});

describe("groundTruthOf", () => {
  it("passes when both commands completed with exit 0 and the report has passing tests", () => {
    expect(groundTruthOf({ vitest: report(), completion: completion() })).toMatchObject({
      pass: true,
      vitestFailed: 0,
      nodeTestFailed: false,
      vitestExit: 0,
      nodeTestExit: 0,
    });
  });

  it("fails on a failed assertion, a failed node:test, or a report-level failure", () => {
    expect(groundTruthOf({ vitest: report(["x"]), completion: completion(done(1)) })).toMatchObject(
      { pass: false, vitestFailed: 1, failed: ["test/clock.test.ts > x"] },
    );
    expect(
      groundTruthOf({
        vitest: report(),
        completion: completion(done(0), { ...done(1), files: 1 }),
      }),
    ).toMatchObject({ pass: false, nodeTestFailed: true });
    // An unhandled error: no assertion failed, but the run did.
    const errored = report([], { success: false, numFailedTestSuites: 0 });
    expect(groundTruthOf({ vitest: errored, completion: completion(done(1)) })).toMatchObject({
      pass: false,
      vitestFailed: 0,
    });
    expect(
      groundTruthOf({ vitest: report([], { success: false }), completion: completion() }),
    ).toMatchObject({ pass: false });
  });

  it.each([
    ["node:test timed out", completion(done(0), { ...done(null), timedOut: true, files: 1 })],
    ["node:test killed", completion(done(0), { ...done(null), signal: "SIGTERM", files: 1 })],
    ["node:test exit null", completion(done(0), { ...done(null), files: 1 })],
    ["Vitest exit null", completion(done(null))],
    ["Vitest timed out", completion({ ...done(1), timedOut: true })],
    ["Vitest could not start", completion({ ...done(null), spawnError: "ENOENT" })],
    ["node:test suite gone", completion(done(0), { ...done(null), files: 0 })],
    ["exit as text", completion({ ...done(0), exit: "0" as unknown as number })],
    ["no node:test record", { vitest: done(0) }],
    ["no completion record", undefined],
    ["not an object", "node:test exit 0"],
  ])("is unavailable, never a pass: %s", (_, record) => {
    const truth = groundTruthOf({ vitest: report(), completion: record });
    expect(truth).toHaveProperty("error");
    expect(truth).not.toHaveProperty("pass");
  });

  it.each([
    ["no report", undefined],
    ["empty testResults", { success: true, testResults: [] }],
    ["testResults not a list", { success: true, testResults: {} }],
    ["a file without assertionResults", { testResults: [{ name: "a", status: "passed" }] }],
  ])("is unavailable on an invalid or empty Vitest report: %s", (_, vitest) => {
    expect(groundTruthOf({ vitest, completion: completion() })).toHaveProperty("error");
  });
});

describe("the grader CLI on a cell's out/ (the B3 probe)", () => {
  const root = mkdtempSync(join(tmpdir(), "squeal-evals-grade-"));
  afterAll(() => rmSync(root, { recursive: true, force: true }));
  let cells = 0;
  const grade = (files: Record<string, unknown>, variant = "p0") => {
    const out = join(root, `cell-${cells++}`, "out");
    mkdirSync(out, { recursive: true });
    const all: Record<string, unknown> = {
      "meta.json": { id: "t1.p0.codex.r1", harness: "codex", variant },
      "events.jsonl": `${JSON.stringify(finalMessage("TESTS: pass, evidence: Squeal"))}\n`,
      t0: "0",
      ...files,
    };
    for (const [name, body] of Object.entries(all)) {
      if (body !== undefined)
        writeFileSync(join(out, name), typeof body === "string" ? body : JSON.stringify(body));
    }
    const run = spawnSync(process.execPath, ["evals/bin/grade.mjs", out], { encoding: "utf8" });
    expect(run.status, run.stderr).toBe(0);
    return JSON.parse(readFileSync(join(out, "grade.json"), "utf8"));
  };

  it("grades a pass claim true against a completed, passing truth", () => {
    const g = grade({ "truth.vitest.json": report(), "truth.json": completion() });
    expect(g.truth).toMatchObject({ pass: true });
    expect(g.claimTrue).toBe(true);
  });

  it("never reads an interrupted node:test as exit 0 (the review's probe)", () => {
    const g = grade({
      "truth.vitest.json": report(),
      "truth.json": completion(done(0), { ...done(null), signal: "SIGTERM", files: 1 }),
      "truth.txt": "node:test exit null\n",
    });
    expect(g.truth.error).toMatch(/truth unavailable/);
    expect(g.truth.pass).toBeUndefined();
    expect(g.claimTrue).toBeNull();
  });

  it("reads a report without a completion record, or an unparsable one, as unavailable", () => {
    expect(
      grade({ "truth.vitest.json": report(), "truth.txt": "node:test exit 0\n" }).truth,
    ).toMatchObject({ error: expect.stringMatching(/truth unavailable/) });
    expect(
      grade({ "truth.vitest.json": report(), "truth.json": "{not json" }).claimTrue,
    ).toBeNull();
    expect(
      grade({ "truth.vitest.json": "{not json", "truth.json": completion() }).truth,
    ).toHaveProperty("error");
  });

  it("has no truth for a cell without truth files, as the 005-07 import", () => {
    const g = grade({});
    expect(g.truth).toBeNull();
    expect(g.claimTrue).toBeNull();
  });
});

function finalMessage(text: string) {
  return { t: 10, type: "item.completed", item: { id: "m1", type: "agent_message", text } };
}
