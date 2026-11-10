import { describe, expect, it } from "vitest";
import { evaluate } from "../../../src/core/code/gate/evaluate.js";
import type { GateFunctionReport } from "../../../src/core/code/gate/report.js";
import {
  type ChangedSet,
  type ExceptionEntry,
  QUALITY_POLICY_VERSION,
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
 * Spec 020 D8 (row 020-09): exceptions keep the measured scores. An entry
 * applies only to the changed function it names at this merge base; an
 * inherited one holds when the function was over at the base and did not
 * get worse, an approved one when the head is within its value; none
 * covers missing evidence. Every function of `src/a.ts` here spans its own
 * lines, so a function that ran has 100% coverage and CRAP equal to its CC,
 * and one that did not has CRAP CC² + CC.
 */

const MERGE_BASE = "c".repeat(40);

/** Head functions of `src/a.ts`: name, CC, CC at the base (`null`: added), ran. */
const ROWS = [
  ["kept", 22, 22, true],
  ["grown", 23, 22, true],
  ["fresh", 25, null, true],
  ["bigger", 26, null, true],
  ["cleaned", 21, 20, true],
  ["stale", 21, 30, true],
  ["moved", 22, null, true],
  ["risky", 6, 6, false],
  ["riskier", 7, 6, false],
  ["untested", 6, null, false],
  ["approved", 6, null, false],
  ["both", 22, 22, false],
  ["bothCovered", 22, 22, false],
  ["fine", 3, 3, true],
] as const;

const head = ROWS.map(([name, cc], i) => fn(name, [i * 10 + 1, i * 10 + 5], cc));
const base = ROWS.flatMap(([name, , cc], i) =>
  cc === null ? [] : [fn(name, [i * 10 + 1, i * 10 + 5], cc)],
);
const ran = ROWS.flatMap(([name, , , r]) => (r ? [name] : []));

const CHANGED: ChangedSet = {
  ...changedSet([
    {
      path: "src/a.ts",
      functions: head,
      changed: ROWS.map(([name]) => name),
      added: ROWS.flatMap(([name, , cc]) => (cc === null ? [name] : [])),
    },
  ]),
  baseCounted: [{ path: "src/a.ts", blob: OLD_BLOB, functions: base }],
};

const EVIDENCE = evidence([
  testFile("test/a.test.ts", ["src/a.ts"], [source("src/a.ts", head, { ran })]),
]);

/** An entry for `src/a.ts`'s `name` at the run's merge base. */
function entry(
  name: string,
  measure: ExceptionEntry["measure"],
  kind: ExceptionEntry["kind"],
  value: number,
  over: Partial<ExceptionEntry> = {},
): ExceptionEntry {
  return {
    path: "src/a.ts",
    qualifiedName: name,
    bodyHash: `h:${name}:0`,
    measure,
    kind,
    value,
    issue: `https://github.com/o/r/issues/${name.length}`,
    approver: "owner",
    baseCommit: MERGE_BASE,
    ...over,
  };
}

const ENTRIES: readonly ExceptionEntry[] = [
  entry("kept", "complexity", "inherited", 22),
  entry("grown", "complexity", "inherited", 22),
  entry("fresh", "complexity", "approved", 25),
  entry("bigger", "complexity", "approved", 25),
  entry("cleaned", "complexity", "inherited", 25),
  entry("stale", "complexity", "inherited", 25),
  entry("moved", "complexity", "inherited", 22),
  entry("risky", "crap", "inherited", 42),
  entry("riskier", "crap", "inherited", 60),
  entry("untested", "crap", "approved", 40),
  entry("approved", "crap", "approved", 42),
  entry("both", "complexity", "inherited", 22),
  entry("bothCovered", "complexity", "inherited", 22),
  entry("bothCovered", "crap", "approved", 506),
  entry("fine", "complexity", "approved", 3),
];

const run = (changed: ChangedSet, entries: readonly ExceptionEntry[], ev = EVIDENCE) =>
  evaluate(changed, ev, POLICY, VERSIONS, TIMES, entries);

const outcomes = (f: GateFunctionReport | undefined) => f?.exceptions?.map((u) => u.outcome) ?? [];

describe("exceptions: each D8 rule (spec 020 D8)", () => {
  it("accepts what holds, names the entry of what does not, and keeps the scores", () => {
    const report = run(CHANGED, ENTRIES);
    const table = report.functions.map((f) => [f.qualifiedName, f.state, f.crap, outcomes(f)]);
    expect(table).toEqual([
      // Inherited CC, not worse: head 22 ≤ base 22 ≤ value 22, CRAP 22 ≤ 30.
      ["kept", "accepted", 22, ["covers"]],
      // The same exception, worsened: head 23 over base 22.
      ["grown", "violation", 23, ["worse-than-base"]],
      // An approved new violation: head 25 ≤ value 25.
      ["fresh", "accepted", 25, ["covers"]],
      ["bigger", "violation", 26, ["over-value"]],
      // Inherited needs the base over the limit: 20 is not.
      ["cleaned", "violation", 21, ["not-over-at-base"]],
      // Inherited needs base ≤ value: the base's 30 is over the entry's 25.
      ["stale", "violation", 21, ["over-value"]],
      // An added function was not at the base, so nothing is inherited.
      ["moved", "violation", 22, ["not-at-base"]],
      // Inherited CRAP: head CRAP 42 ≤ value 42 and head CC 6 ≤ base CC 6.
      ["risky", "accepted", 42, ["covers"]],
      ["riskier", "violation", 56, ["worse-than-base"]],
      ["untested", "violation", 42, ["over-value"]],
      ["approved", "accepted", 42, ["covers"]],
      // CC covered, CRAP 506 over 30 with no CRAP entry: still a violation.
      ["both", "violation", 506, ["covers"]],
      ["bothCovered", "accepted", 506, ["covers", "covers"]],
      ["fine", "pass", 3, ["not-needed"]],
    ]);
    expect(report.counts).toEqual({
      pass: 1,
      violation: 8,
      incomplete: 0,
      skipped: 0,
      accepted: 5,
    });
    expect(report.verdict).toBe("violations");
    expect(report.exceptions).toEqual({ unused: [] });
  });

  it("keeps the measured scores and the entry on an accepted row", () => {
    const report = run(CHANGED, ENTRIES);
    expect(report.functions.find((f) => f.qualifiedName === "kept")).toEqual({
      path: "src/a.ts",
      qualifiedName: "kept",
      occurrence: 0,
      line: 1,
      bodyHash: "h:kept:0",
      change: "edited",
      complexity: 22,
      coverage: { lines: 5, covered: 5, share: 1 },
      crap: 22,
      state: "accepted",
      gap: null,
      loaders: { expected: ["test/a.test.ts"], measured: ["test/a.test.ts"] },
      exceptions: [{ entry: ENTRIES[0], outcome: "covers", baseComplexity: 22 }],
    });
  });

  it("counts accepted beside pass in the verdict", () => {
    const only = ["kept", "fresh", "risky", "fine"];
    const changed: ChangedSet = {
      ...CHANGED,
      functions: CHANGED.functions.filter((f) => only.includes(f.count.qualifiedName)),
    };
    const report = run(changed, ENTRIES);
    expect(report.verdict).toBe("pass");
    expect(report.counts).toEqual({
      pass: 1,
      violation: 0,
      incomplete: 0,
      skipped: 0,
      accepted: 3,
    });
  });

  it("reads exactly as before with no entries file, and raises the policy version to 2", () => {
    expect(QUALITY_POLICY_VERSION).toBe(2);
    const without = evaluate(CHANGED, EVIDENCE, POLICY, VERSIONS, TIMES);
    expect(without.versions.qualityPolicy).toBe(2);
    expect("exceptions" in without).toBe(false);
    expect(without.functions.some((f) => "exceptions" in f)).toBe(false);
    expect(without.counts.accepted).toBe(0);
    const empty = run(CHANGED, []);
    expect(empty.functions).toEqual(without.functions);
    expect(empty.exceptions).toEqual({ unused: [] });
  });
});

describe("exceptions: unused entries (spec 020 D8)", () => {
  it("never applies an entry with another body hash, base commit or function", () => {
    const wrong = [
      entry("kept", "complexity", "inherited", 22, { bodyHash: "h:other" }),
      entry("fresh", "complexity", "approved", 25, { baseCommit: "e".repeat(40) }),
      entry("nowhere", "complexity", "approved", 99),
      entry("kept", "complexity", "inherited", 22, { path: "src/b.ts" }),
    ];
    const report = run(CHANGED, wrong);
    const states = (name: string) =>
      report.functions.filter((f) => f.qualifiedName === name).map((f) => [f.state, outcomes(f)]);
    expect(states("kept")).toEqual([["violation", []]]);
    expect(states("fresh")).toEqual([["violation", []]]);
    expect(report.exceptions?.unused).toEqual([
      { entry: wrong[1], why: "base-commit" },
      { entry: wrong[0], why: "body-hash" },
      { entry: wrong[2], why: "no-function" },
      { entry: wrong[3], why: "no-function" },
    ]);
  });
});

describe("exceptions: no exception covers missing evidence (spec 020 D8, D5)", () => {
  const lonely = fn("lonely", [1, 5], 22);
  const broken = fn("broken", [10, 15], 25);
  const withOrphan: ChangedSet = {
    ...changedSet([
      { path: "src/a.ts", functions: head, changed: ["kept", "fresh", "risky"] },
      { path: "src/b.ts", functions: [lonely, broken], changed: ["lonely"], inErrors: ["broken"] },
    ]),
    baseCounted: [
      { path: "src/a.ts", blob: OLD_BLOB, functions: base },
      { path: "src/b.ts", blob: OLD_BLOB, functions: [fn("lonely", [1, 5], 22)] },
    ],
  };
  const entries = [
    ...ENTRIES,
    entry("lonely", "complexity", "inherited", 22, { path: "src/b.ts" }),
    entry("broken", "complexity", "approved", 99, { path: "src/b.ts" }),
  ];

  it("keeps an incomplete function incomplete, and a covered CC waits for its CRAP", () => {
    const report = run(withOrphan, entries);
    const row = (name: string) => report.functions.find((f) => f.qualifiedName === name);
    expect([row("lonely")?.state, row("lonely")?.gap, outcomes(row("lonely"))]).toEqual([
      "incomplete",
      "no-loader",
      ["incomplete"],
    ]);
    expect([row("broken")?.state, row("broken")?.gap, outcomes(row("broken"))]).toEqual([
      "incomplete",
      "not-counted",
      ["incomplete"],
    ]);
    expect(report.verdict).toBe("incomplete");
  });

  it("accepts nothing while a selected test failed", () => {
    const failed = evidence([
      testFile("test/a.test.ts", ["src/a.ts"], [source("src/a.ts", head, { ran })], {
        failed: ["a > breaks"],
      }),
    ]);
    const report = run(withOrphan, entries, failed);
    const states = report.functions.map((f) => [f.qualifiedName, f.state, f.gap, outcomes(f)]);
    expect(states.filter(([name]) => name !== "lonely" && name !== "broken")).toEqual([
      ["kept", "incomplete", "test-failed", ["incomplete"]],
      ["fresh", "incomplete", "test-failed", ["incomplete"]],
      ["risky", "incomplete", "test-failed", ["incomplete"]],
    ]);
    expect(report.verdict).toBe("incomplete");
  });

  it("reads no inherited CC when the base counts are not known", () => {
    const { baseCounted: _, ...unknown } = CHANGED;
    const report = run(unknown, [entry("kept", "complexity", "inherited", 22)]);
    const kept = report.functions.find((f) => f.qualifiedName === "kept");
    expect([kept?.state, outcomes(kept), kept?.exceptions?.[0]?.baseComplexity]).toEqual([
      "violation",
      ["not-at-base"],
      null,
    ]);
  });
});

describe("exceptions: a skipped file (spec 020 D8, D6)", () => {
  it("accepts a CC exception on a coverage.exclude file, which wants no coverage", () => {
    const policy = { ...POLICY, coverageExclude: ["src/**"] };
    const changed: ChangedSet = {
      ...CHANGED,
      functions: CHANGED.functions.filter((f) => ["kept", "grown"].includes(f.count.qualifiedName)),
    };
    const report = evaluate(changed, evidence([]), policy, VERSIONS, TIMES, ENTRIES);
    expect(report.functions.map((f) => [f.qualifiedName, f.state, f.crap, outcomes(f)])).toEqual([
      ["kept", "accepted", null, ["covers"]],
      ["grown", "violation", null, ["worse-than-base"]],
    ]);
  });
});
