import { describe, expect, it } from "vitest";
import { formatGateReport } from "../../src/cli/code-gate-text.js";
import type { PrepareRun } from "../../src/core/code/gate/prepare.js";
import type { GateReport } from "../../src/core/code/gate/report.js";
import { functionRow, gateReport } from "./code-gate-text-kit.js";

/*
 * Spec 020 D15.3 (row 020-16b): the text names each node:test entry whose
 * `prepare` kept its files from running, and why; a function that waited
 * for one reads `not-prepared` in words. A `prepare` that passed adds no line.
 */

const prepare = (over: Partial<PrepareRun>): PrepareRun => ({
  project: "package",
  command: ["node", "scripts/build.mjs"],
  outcome: "passed",
  exit: 0,
  durationMs: 40,
  notRun: [],
  ...over,
});

const REPORT: GateReport = gateReport({
  base: { ref: "main" },
  functions: [
    functionRow({
      path: "test/e2e/bin.test.mjs",
      qualifiedName: "verify",
      line: 7,
      state: "incomplete",
      gap: "not-prepared",
      loaders: { expected: ["test/e2e/bin.test.mjs"], measured: [] },
    }),
  ],
  runs: [
    {
      runner: "node-test",
      selected: ["a.test.mjs", "b.test.mjs", "c.test.mjs", "test/e2e/bin.test.mjs"],
      completed: [],
      notFinished: [],
      failed: [],
      prepare: [
        prepare({
          project: "build",
          outcome: "failed",
          exit: 2,
          notRun: ["a.test.mjs", "b.test.mjs"],
        }),
        prepare({ project: "ok" }),
        prepare({
          project: "package",
          outcome: "not-at-base",
          exit: null,
          durationMs: null,
          notRun: ["test/e2e/bin.test.mjs"],
        }),
        prepare({ project: "slow", outcome: "timed-out", exit: null, notRun: ["c.test.mjs"] }),
      ],
      durationMs: null,
    },
  ],
  verdict: "incomplete",
  counts: { pass: 0, violation: 0, incomplete: 1, skipped: 0, accepted: 0 },
});

describe("formatGateReport: prepare (spec 020 D15.3)", () => {
  it("names each entry whose prepare kept its files from running", () => {
    expect(formatGateReport(REPORT, "squeal code --base main --json").split("\n")).toEqual([
      "Code gate: incomplete. 1 changed function against main (merge base 01234567): 1 incomplete.",
      "  test/e2e/bin.test.mjs:7  verify  CC 3: incomplete: a test file that loads it did not run: its node:test entry's prepare did not pass, or the base does not declare it",
      '  node:test entry "build": prepare failed (exit 2): 2 test files did not run',
      '  node:test entry "package": prepare is declared only at the head, so it did not run; land the declaration on the base branch first: 1 test file did not run',
      '  node:test entry "slow": prepare did not finish in time: 1 test file did not run',
      "JSON report: squeal code --base main --json",
      "",
    ]);
  });
});
