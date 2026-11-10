import { describe, expect, it } from "vitest";
import { evaluate } from "../../../src/core/code/gate/evaluate.js";
import type { GateFunctionReport } from "../../../src/core/code/gate/report.js";
import type { ExceptionEntry, TestFileEvidence } from "../../../src/core/code/gate/types.js";
import {
  changedSet,
  evidence,
  fn,
  POLICY,
  source,
  TIMES,
  testFile,
  VERSIONS,
} from "./evaluate-fixture.js";

/*
 * Spec 020 D8 with D11.3 (row 020-07a I): a loader that skipped a test
 * gives a bound, like a subset of the loaders (review 0.1.424 B1). Its
 * records prove an ordinary pass, never a violation, and they are not the
 * complete head evidence an exception needs. `debt` has CC 22, over the
 * limit of 20; its one loader ran all of it and skipped a test.
 */

const debt = fn("debt", [1, 5], 22);
const small = fn("small", [10, 14], 6);

const changed = changedSet([
  {
    path: "src/a.ts",
    functions: [debt, small],
    changed: ["debt", "small"],
    added: ["debt", "small"],
  },
]);

const skipping = testFile("test/a.test.ts", ["src/a.ts"], [source("src/a.ts", [debt, small])], {
  skipped: true,
});

const approved: ExceptionEntry = {
  path: "src/a.ts",
  qualifiedName: "debt",
  bodyHash: debt.bodyHash,
  baseCommit: changed.baseCommit,
  measure: "complexity",
  kind: "approved",
  value: 22,
  issue: "https://example.com/1",
  approver: "owner",
};

const run = (files: readonly TestFileEvidence[], entries?: readonly ExceptionEntry[]) =>
  evaluate(changed, evidence(files), POLICY, VERSIONS, TIMES, entries);

const row = (report: ReturnType<typeof run>, name: string) =>
  report.functions.find((f) => f.qualifiedName === name) as GateFunctionReport;

const outcomes = (f: GateFunctionReport) => f.exceptions?.map((u) => u.outcome) ?? [];

describe("exceptions: a loader that skipped a test accepts nothing (spec 020 D8, D11.3)", () => {
  it("reads a covered CC violation incomplete, skipped, and keeps the scores", () => {
    const report = run([skipping], [approved]);
    const debtRow = row(report, "debt");
    expect([debtRow.state, debtRow.gap, debtRow.crap, outcomes(debtRow)]).toEqual([
      "incomplete",
      "skipped",
      22,
      ["incomplete"],
    ]);
    expect(report.verdict).toBe("incomplete");
  });

  it("accepts the same entry when the loader skipped nothing", () => {
    const whole = { ...skipping, skipped: false };
    const debtRow = row(run([whole], [approved]), "debt");
    expect([debtRow.state, debtRow.gap, outcomes(debtRow)]).toEqual(["accepted", null, ["covers"]]);
  });

  it("keeps the CC violation without an entry, and the bound's pass under both limits", () => {
    const report = run([skipping]);
    expect([row(report, "debt").state, row(report, "debt").gap]).toEqual(["violation", null]);
    for (const entries of [undefined, [approved]]) {
      const smallRow = row(run([skipping], entries), "small");
      expect([smallRow.state, smallRow.gap, smallRow.crap]).toEqual(["pass", null, 6]);
    }
  });
});
