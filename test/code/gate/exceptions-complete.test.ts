import { describe, expect, it } from "vitest";
import { evaluate } from "../../../src/core/code/gate/evaluate.js";
import type { GateFunctionReport } from "../../../src/core/code/gate/report.js";
import type {
  ChangedSet,
  ExceptionEntry,
  TestFileEvidence,
} from "../../../src/core/code/gate/types.js";
import {
  changedSet,
  evidence,
  fn,
  OLD_BLOB,
  POLICY,
  source,
  TIMES,
  testFile,
  VERSIONS,
} from "./evaluate-fixture.js";

/*
 * Spec 020 D8 with D5 (review 0.1.424 B1): an exception needs complete
 * head evidence, a whole record from each loading test file. D5's subset
 * bound proves an ordinary pass from the records in hand; it never lets an
 * exception accept a function. `debt` has CC 22, over the limit of 20, and
 * spans its own lines: the loader that ran it gives 100% coverage, so its
 * CRAP is 22.
 */

const debt = fn("debt", [1, 5], 22);
const small = fn("small", [10, 14], 6);

/** `debt` (and `small`) changed in `src/a.ts`; `debt` added, or edited from CC 22 at the base. */
function changedOf(change: "added" | "edited"): ChangedSet {
  return {
    ...changedSet([
      {
        path: "src/a.ts",
        functions: [debt, small],
        changed: ["debt", "small"],
        added: change === "added" ? ["debt", "small"] : [],
      },
    ]),
    baseCounted: [{ path: "src/a.ts", blob: OLD_BLOB, functions: [debt, small] }],
  };
}

const good = testFile("test/good.test.ts", ["src/a.ts"], [source("src/a.ts", [debt, small])]);
/** A loader that completed and gave no record. */
const noRecord = testFile("test/missing.test.ts", ["src/a.ts"], [], { record: null });
/** A loader that did not finish. */
const unfinished = testFile("test/stopped.test.ts", ["src/a.ts"], [], {
  record: null,
  completed: false,
});
/** A second loader with its whole record. */
const other = testFile("test/other.test.ts", ["src/a.ts"], [source("src/a.ts", [debt, small])]);

function entry(kind: ExceptionEntry["kind"], over: Partial<ExceptionEntry> = {}): ExceptionEntry {
  return {
    path: "src/a.ts",
    qualifiedName: "debt",
    bodyHash: debt.bodyHash,
    baseCommit: "c".repeat(40),
    measure: "complexity",
    kind,
    value: 22,
    issue: "https://example.com/1",
    approver: "owner",
    ...over,
  };
}

const run = (
  change: "added" | "edited",
  files: readonly TestFileEvidence[],
  entries?: readonly ExceptionEntry[],
) => evaluate(changedOf(change), evidence(files), POLICY, VERSIONS, TIMES, entries);

const row = (report: ReturnType<typeof run>, name = "debt") =>
  report.functions.find((f) => f.qualifiedName === name) as GateFunctionReport;

const outcomes = (f: GateFunctionReport) => f.exceptions?.map((u) => u.outcome) ?? [];

describe("exceptions: a subset of the loaders accepts nothing (spec 020 D8, D5; review 0.1.424 B1)", () => {
  it("reads the review's reproduction incomplete, no-record, and keeps the scores and the entry", () => {
    const approved = entry("approved");
    const report = run("added", [good, noRecord], [approved]);
    expect(row(report)).toEqual({
      path: "src/a.ts",
      qualifiedName: "debt",
      occurrence: 0,
      line: 1,
      bodyHash: debt.bodyHash,
      change: "added",
      complexity: 22,
      coverage: { lines: 5, covered: 5, share: 1 },
      crap: 22,
      state: "incomplete",
      gap: "no-record",
      loaders: {
        expected: ["test/good.test.ts", "test/missing.test.ts"],
        measured: ["test/good.test.ts"],
      },
      exceptions: [{ entry: approved, outcome: "incomplete", baseComplexity: null }],
    });
    expect(report.verdict).toBe("incomplete");
    expect(report.counts).toMatchObject({ accepted: 0, incomplete: 1, pass: 1 });
  });

  it("reads an inherited CC entry the same way", () => {
    const inherited = entry("inherited");
    const report = run("edited", [good, noRecord], [inherited]);
    const debtRow = row(report);
    expect([debtRow.state, debtRow.gap, debtRow.crap, debtRow.exceptions]).toEqual([
      "incomplete",
      "no-record",
      22,
      [{ entry: inherited, outcome: "incomplete", baseComplexity: 22 }],
    ]);
    expect(report.verdict).toBe("incomplete");
  });

  it("accepts an approved and an inherited CC entry when every loader gave its record", () => {
    for (const [change, kind] of [
      ["added", "approved"],
      ["edited", "inherited"],
    ] as const) {
      const report = run(change, [good, other], [entry(kind)]);
      const debtRow = row(report);
      expect([debtRow.state, debtRow.gap, debtRow.crap, outcomes(debtRow)]).toEqual([
        "accepted",
        null,
        22,
        ["covers"],
      ]);
      expect(debtRow.loaders.measured).toEqual(["test/good.test.ts", "test/other.test.ts"]);
      expect(report.verdict).toBe("pass");
    }
  });

  it("reads a loader that did not finish not-finished with an entry, and a CC violation without", () => {
    const covered = row(run("added", [good, unfinished], [entry("approved")]));
    expect([covered.state, covered.gap, outcomes(covered)]).toEqual([
      "incomplete",
      "not-finished",
      ["incomplete"],
    ]);
    const bare = row(run("added", [good, unfinished]));
    expect([bare.state, bare.gap, outcomes(bare)]).toEqual(["violation", null, []]);
  });

  it("keeps the CC violation of the subset without an entry", () => {
    const report = run("added", [good, noRecord]);
    expect([row(report).state, row(report).gap, report.verdict]).toEqual([
      "violation",
      null,
      "violations",
    ]);
  });

  it("still passes a function under both limits from the subset, with entries or without", () => {
    for (const entries of [undefined, [], [entry("approved")]]) {
      const smallRow = row(run("added", [good, noRecord], entries), "small");
      expect([smallRow.state, smallRow.gap, smallRow.crap, smallRow.exceptions]).toEqual([
        "pass",
        null,
        6,
        undefined,
      ]);
    }
  });

  it("does not let a CRAP entry turn the subset's pass into an acceptance", () => {
    const crap = entry("approved", { qualifiedName: "small", bodyHash: small.bodyHash });
    const smallRow = row(
      run("added", [good, noRecord], [{ ...crap, measure: "crap", value: 6 }]),
      "small",
    );
    expect([smallRow.state, smallRow.gap, outcomes(smallRow)]).toEqual([
      "pass",
      null,
      ["not-needed"],
    ]);
  });
});
