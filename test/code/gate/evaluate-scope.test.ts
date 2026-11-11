import { describe, expect, it } from "vitest";
import { evaluate } from "../../../src/core/code/gate/evaluate.js";
import type { BasePolicy } from "../../../src/core/code/gate/policy.js";
import {
  type LeftOutFile,
  readScope,
  type ScopeEvidence,
} from "../../../src/core/code/gate/scope.js";
import type { ExceptionEntry, TestFileEvidence } from "../../../src/core/code/gate/types.js";
import { DEFAULT_POLICY } from "../../../src/core/types/policy.js";
import {
  changedSet,
  evidence,
  fn,
  type PathInput,
  POLICY,
  source,
  TIMES,
  testFile,
  VERSIONS,
} from "./evaluate-fixture.js";

/*
 * Spec 020 D14.2 and D14.3 (row 020-15a): a selected test file in a group
 * outside the scope does not run; its closure says which changed sources
 * it loads. In-scope evidence that is complete and passes still passes; a
 * CRAP over the limit reads `left-out`, since more coverage could lower
 * it; a CC over the limit stays a violation.
 */

const BROWSER = "e2e/page.test.ts";

/** A browser file the scope left out, loading `loads`. */
const leftOut = (loads: readonly string[] | null, path = BROWSER): LeftOutFile => ({
  runner: "vitest",
  path,
  group: "browser",
  loads,
});

/** The scope evidence of a run that left out `files`, all of the manual `browser` group. */
function scoped(files: readonly LeftOutFile[]): ScopeEvidence {
  return {
    inScope: [
      { name: "tests", at: "edit", from: "default" },
      { name: "slow", at: "edit", from: "default" },
    ],
    leftOut: [
      { name: "browser", at: "manual", files: 3, selected: files.length, add: "--group browser" },
    ],
    files,
  };
}

function judged(
  paths: readonly PathInput[],
  files: readonly TestFileEvidence[],
  left: readonly LeftOutFile[],
  options: { policy?: BasePolicy; exceptions?: readonly ExceptionEntry[] } = {},
) {
  const run = { ...evidence(files), scope: scoped(left) };
  const policy = options.policy ?? { ...POLICY, scope: readScope(DEFAULT_POLICY).base };
  const report = evaluate(changedSet(paths), run, policy, VERSIONS, TIMES, options.exceptions);
  const by = Object.fromEntries(report.functions.map((f) => [f.qualifiedName, f]));
  return { report, by };
}

const covered = fn("covered", [1, 5], 6);
const missed = fn("missed", [10, 14], 6);
const big = fn("big", [20, 24], 21);
const A = {
  path: "src/a.ts",
  functions: [covered, missed, big],
  changed: ["covered", "missed", "big"],
};
/** An in-scope loader that ran `covered` and `big`, and not `missed`. */
const unit = testFile(
  "test/a.test.ts",
  ["src/a.ts"],
  [source("src/a.ts", [covered, missed, big], { ran: ["covered", "big"] })],
);

describe("evaluate: a loader the scope left out (spec 020 D14.2)", () => {
  it("passes on complete in-scope evidence, and lists the left-out loader", () => {
    const { report, by } = judged(
      [{ ...A, changed: ["covered"] }],
      [unit],
      [leftOut(["src/a.ts"]), leftOut(["src/other.ts"], "e2e/other.test.ts")],
    );
    expect(by.covered).toMatchObject({
      state: "pass",
      gap: null,
      crap: 6,
      loaders: { expected: ["test/a.test.ts"], measured: ["test/a.test.ts"], leftOut: [BROWSER] },
    });
    expect(report.verdict).toBe("pass");
  });

  it("reads a CRAP over the limit as incomplete, left-out; a CC over it stays a violation", () => {
    const { report, by } = judged([A], [unit], [leftOut(["src/a.ts"])]);
    expect(by.missed).toMatchObject({ state: "incomplete", gap: "left-out", crap: 42 });
    expect(by.big).toMatchObject({ state: "violation", gap: null });
    expect(report.verdict).toBe("violations");
    const alone = judged([{ ...A, changed: ["missed"] }], [unit], [leftOut(["src/a.ts"])]);
    expect(alone.report.verdict).toBe("incomplete");
    expect(alone.report.counts).toMatchObject({ incomplete: 1, violation: 0 });
  });

  it("counts a left-out file whose closure is not known as a loader that may load", () => {
    const { by } = judged([{ ...A, changed: ["missed"] }], [unit], [leftOut(null)]);
    expect(by.missed).toMatchObject({ state: "incomplete", gap: "left-out" });
    expect(by.missed?.loaders.leftOut).toEqual([BROWSER]);
  });

  it("reads a source only left-out files load as left-out, not as no loader", () => {
    const { by } = judged([{ ...A, changed: ["covered"] }], [], [leftOut(["src/a.ts"])]);
    expect(by.covered).toMatchObject({
      state: "incomplete",
      gap: "left-out",
      loaders: { expected: [], measured: [], leftOut: [BROWSER] },
    });
  });

  it("reads a changed test file of a left-out group as left-out, or skipped by coverage.exclude", () => {
    const spec = fn("page spec", [1, 9], 3);
    const paths = [{ path: BROWSER, functions: [spec], changed: ["page spec"] }];
    const left = [leftOut([BROWSER, "src/a.ts"])];
    expect(judged(paths, [], left).by["page spec"]).toMatchObject({
      state: "incomplete",
      gap: "left-out",
    });
    const policy = { ...POLICY, coverageExclude: ["e2e/**"] };
    const { by, report } = judged(paths, [], left, { policy });
    expect(by["page spec"]).toMatchObject({ state: "skipped", gap: null });
    expect(report.verdict).toBe("pass");
  });
});

describe("evaluate: D8 exceptions beside a left-out loader (spec 020 D14.2)", () => {
  const entry = (over: Partial<ExceptionEntry>): ExceptionEntry => ({
    path: "src/a.ts",
    qualifiedName: "big",
    bodyHash: big.bodyHash,
    baseCommit: "c".repeat(40),
    measure: "complexity",
    kind: "approved",
    value: 21,
    issue: "https://example.com/1",
    approver: "owner",
    ...over,
  });
  const crapEntry = entry({
    qualifiedName: "missed",
    bodyHash: missed.bodyHash,
    measure: "crap",
    value: 42,
  });
  const left = [leftOut(["src/a.ts"])];

  it("covers a CC and a CRAP violation on complete in-scope evidence", () => {
    const exceptions = [entry({}), crapEntry];
    const { by, report } = judged([A], [unit], left, { exceptions });
    expect(by.big).toMatchObject({ state: "accepted", gap: null });
    expect(by.missed).toMatchObject({ state: "accepted", gap: null, crap: 42 });
    expect(by.missed?.exceptions?.map((u) => u.outcome)).toEqual(["covers"]);
    expect(report.verdict).toBe("pass");
  });

  it("keeps the CRAP violation incomplete, left-out, with no entry or one it is over", () => {
    const none = judged([{ ...A, changed: ["missed"] }], [unit], left, { exceptions: [] });
    expect(none.by.missed).toMatchObject({ state: "incomplete", gap: "left-out" });
    const low = { ...crapEntry, value: 41 };
    const over = judged([{ ...A, changed: ["missed"] }], [unit], left, { exceptions: [low] });
    expect(over.by.missed).toMatchObject({ state: "incomplete", gap: "left-out" });
    expect(over.by.missed?.exceptions?.map((u) => u.outcome)).toEqual(["over-value"]);
    expect(over.report.verdict).toBe("incomplete");
  });

  it("keeps it incomplete when an in-scope loader did not finish", () => {
    const stopped = testFile("test/stopped.test.ts", ["src/a.ts"], [], {
      record: null,
      completed: false,
    });
    const { by } = judged([{ ...A, changed: ["missed"] }], [unit, stopped], left, {
      exceptions: [crapEntry],
    });
    expect(by.missed).toMatchObject({ state: "incomplete", gap: "not-finished" });
    expect(by.missed?.exceptions?.map((u) => u.outcome)).toEqual(["incomplete"]);
  });
});

describe("evaluate: the report's scope (spec 020 D14.3)", () => {
  it("names the groups in scope, each group left out, and gate.groups at the base", () => {
    const { report } = judged([{ ...A, changed: ["covered"] }], [unit], [leftOut(["src/a.ts"])]);
    expect(report.scope).toEqual({
      groups: [
        { name: "tests", at: "edit", from: "default" },
        { name: "slow", at: "edit", from: "default" },
      ],
      leftOut: [{ name: "browser", at: "manual", files: 3, selected: 1, add: "--group browser" }],
    });
    expect(report.base.policy.gateGroups).toBeNull();
  });

  it("is as before with no scope given: no scope, no gateGroups and no leftOut", () => {
    const report = evaluate(changedSet([A]), evidence([unit]), POLICY, VERSIONS, TIMES);
    expect(report).not.toHaveProperty("scope");
    expect(report.base.policy).not.toHaveProperty("gateGroups");
    for (const f of report.functions) expect(f.loaders).not.toHaveProperty("leftOut");
  });
});
