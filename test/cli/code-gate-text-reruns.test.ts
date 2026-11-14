import { describe, expect, it } from "vitest";
import { formatGateReport } from "../../src/cli/code-gate-text.js";
import type { GateReport, GateRunReport } from "../../src/core/code/gate/report.js";
import { functionRow, gateReport } from "./code-gate-text-kit.js";

/*
 * Spec 020 D1 (row 020-63): the text report names the files a run ran once
 * more, per runner: the stored failures `--rerun-stored-failures` reran
 * (row 020-60) and the files that failed under load (row 020-54). Each line
 * counts each outcome and names at most three paths. A run with neither is
 * as before, and the verdict line does not change.
 */

const JSON_COMMAND = "squeal code --base main --json --rerun-stored-failures";

const run = (over: Partial<GateRunReport> = {}): GateRunReport => ({
  runner: "vitest",
  selected: [],
  completed: [],
  notFinished: [],
  failed: [],
  durationMs: null,
  ...over,
});

/** One function that a failed test leaves incomplete, and `runs`. */
const report = (runs: readonly GateRunReport[]): GateReport =>
  gateReport({
    base: { ref: "main" },
    functions: [functionRow({ state: "incomplete", gap: "test-failed" })],
    runs,
    verdict: "incomplete",
    counts: { pass: 0, violation: 0, incomplete: 1, skipped: 0, accepted: 0 },
  });

const FAILED = run({ failed: [{ path: "test/b.test.ts", tests: ["b fails"] }] });

const STORED = run({
  failed: [{ path: "test/b.test.ts", tests: ["b fails"] }],
  notFinished: ["test/e.test.ts"],
  storedRerun: {
    "test/a.test.ts": { outcome: "passed" },
    "test/b.test.ts": { outcome: "failed" },
    "test/c.test.ts": { outcome: "passed" },
    "test/d.test.ts": { outcome: "passed" },
    "test/e.test.ts": { outcome: "not-finished" },
    "test/f.test.ts": { outcome: "passed" },
  },
});

const lines = (r: GateReport) => formatGateReport(r, JSON_COMMAND).split("\n");

describe("formatGateReport: reruns (spec 020 D1, row 020-63)", () => {
  it("counts each stored rerun's outcome and names at most three paths of each", () => {
    expect(lines(report([STORED]))).toEqual([
      "Code gate: incomplete. 1 changed function against main (merge base 01234567): 1 incomplete.",
      "  src/a.ts:1  f  CC 3: incomplete: a selected test failed",
      "  test/b.test.ts: failed: b fails",
      "  test/e.test.ts: did not finish in the 600 s budget",
      "  6 failed Vitest test files read from the stores ran once more (--rerun-stored-failures): 4 passed (test/a.test.ts, test/c.test.ts, test/d.test.ts and 1 more), 1 failed again (test/b.test.ts), 1 did not finish, so the stored failure stands (test/e.test.ts)",
      `JSON report: ${JSON_COMMAND}`,
      "",
    ]);
  });

  it("gives each runner its own line, one file in the singular", () => {
    const node = run({ runner: "node-test", storedRerun: { "t.test.mjs": { outcome: "passed" } } });
    expect(
      lines(report([run({ storedRerun: { "x.test.ts": { outcome: "failed" } } }), node])),
    ).toEqual(
      expect.arrayContaining([
        "  1 failed Vitest test file read from the stores ran once more (--rerun-stored-failures): 1 failed again (x.test.ts)",
        "  1 failed node:test test file read from the stores ran once more (--rerun-stored-failures): 1 passed (t.test.mjs)",
      ]),
    );
  });

  it("names the load reruns with the highest load per CPU, before the stored reruns", () => {
    const both = run({
      retried: {
        "test/l.test.ts": { load: 20, cpus: 8, outcome: "passed" },
        "test/m.test.ts": { load: 30.5, cpus: 24, outcome: "not-finished" },
      },
      storedRerun: { "test/a.test.ts": { outcome: "passed" } },
    });
    expect(lines(report([both])).slice(2, 4)).toEqual([
      "  2 Vitest test files failed while the host load was at or over its CPU count (20 on 8 CPUs) and ran once more: 1 passed (test/l.test.ts), 1 did not finish, so the first failure stands (test/m.test.ts)",
      "  1 failed Vitest test file read from the stores ran once more (--rerun-stored-failures): 1 passed (test/a.test.ts)",
    ]);
  });

  it("is byte-identical to a report without reruns when none ran, and keeps the verdict line", () => {
    const plain = formatGateReport(report([FAILED]), JSON_COMMAND);
    const empty = formatGateReport(
      report([{ ...FAILED, storedRerun: {}, retried: {} }]),
      JSON_COMMAND,
    );
    expect(empty).toBe(plain);
    expect(plain).toBe(
      [
        "Code gate: incomplete. 1 changed function against main (merge base 01234567): 1 incomplete.",
        "  src/a.ts:1  f  CC 3: incomplete: a selected test failed",
        "  test/b.test.ts: failed: b fails",
        `JSON report: ${JSON_COMMAND}`,
        "",
      ].join("\n"),
    );
    expect(lines(report([STORED]))[0]).toBe(plain.split("\n")[0]);
  });
});
