import { describe, expect, it } from "vitest";
import { evaluate } from "../../../src/core/code/gate/evaluate.js";
import type { BasePolicy } from "../../../src/core/code/gate/policy.js";
import type { GateReport } from "../../../src/core/code/gate/report.js";
import type { ChangedSet, Evidence } from "../../../src/core/code/gate/types.js";
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
 * Spec 020 D7 (row 020-01): the whole `squeal-code-gate/1` report of one
 * change, and the same report from the same inputs in any order.
 */

const A = "1".repeat(40);
const B = "2".repeat(40);
const C = "3".repeat(40);
const T = "4".repeat(40);
const H = "5".repeat(40);

const parse = fn("parse", [1, 5], 4);
const render = fn("render", [10, 20], 13);
const map = fn("render.<map>", [12, 14], 2);
const load = fn("load", [1, 8], 6);
const orphan = fn("orphan", [3, 6], 2);
const callback = fn("<callback>", [3, 9], 1);

const CHANGED: ChangedSet = changedSet(
  [
    {
      path: "src/a.ts",
      blob: A,
      functions: [parse, render, map],
      changed: ["parse", "render", "render.<map>"],
      added: ["render.<map>"],
    },
    { path: "src/b.ts", blob: B, functions: [load], changed: ["load"] },
    { path: "src/c.ts", blob: C, functions: [orphan], changed: ["orphan"] },
    { path: "test/a.test.ts", blob: T, functions: [callback], changed: ["<callback>"] },
  ],
  [
    { path: "src/huge.ts", reason: "too-large", blob: H },
    { path: "src/link.ts", reason: "unsupported" },
  ],
);

// `render`'s own lines are 10 to 20 but `render.<map>`'s 13: 5 of those 10 ran.
const EVIDENCE: Evidence = evidence(
  [
    testFile(
      "test/a.test.ts",
      ["src/a.ts", "test/a.test.ts"],
      [
        source("src/a.ts", [parse, render, map], {
          blob: A,
          covered: [1, 2, 3, 4, 5, 10, 11, 12, 13, 14, 15],
        }),
      ],
    ),
    testFile("test/b.test.mts", ["src/b.ts"], [], {
      runner: "node-test",
      completed: false,
      record: null,
    }),
  ],
  true,
);

/** A counting policy other than the defaults: the report carries what the base read (S1). */
const SKIP_TESTS: BasePolicy = {
  ...POLICY,
  coverageExclude: ["test/**"],
  include: ["src/**", "test/**"],
  exclude: ["src/generated/**"],
  maxFileBytes: 65_536,
};
const DURATIONS = { ...TIMES, durationsMs: { vitest: 1200, "node-test": 598_800 } };

const loaders = (expected: string[], measured: string[]) => ({ expected, measured });

const GOLDEN: GateReport = {
  format: "squeal-code-gate/1",
  createdAt: "2026-11-09T12:00:00.000Z",
  versions: {
    squeal: "0.0.0-test",
    counter: 3,
    coverageProvider: 3,
    coverageRecord: 4,
    qualityPolicy: 4,
  },
  base: {
    ref: "origin/main",
    commit: "c".repeat(40),
    policy: {
      complexityThreshold: 20,
      crapThreshold: 30,
      coverageExclude: ["test/**"],
      complexityInclude: ["src/**", "test/**"],
      complexityExclude: ["src/generated/**"],
      complexityMaxFileBytes: 65_536,
    },
  },
  head: {
    commit: "d".repeat(40),
    dirty: false,
    paths: [
      { path: "src/a.ts", blob: A },
      { path: "src/b.ts", blob: B },
      { path: "src/c.ts", blob: C },
      { path: "src/huge.ts", blob: H },
      { path: "test/a.test.ts", blob: T },
    ],
  },
  budget: { seconds: 600, timedOut: true },
  functions: [
    {
      path: "src/a.ts",
      qualifiedName: "parse",
      occurrence: 0,
      line: 1,
      bodyHash: "h:parse:0",
      change: "edited",
      complexity: 4,
      coverage: { lines: 5, covered: 5, share: 1 },
      crap: 4,
      state: "pass",
      gap: null,
      loaders: loaders(["test/a.test.ts"], ["test/a.test.ts"]),
    },
    {
      path: "src/a.ts",
      qualifiedName: "render",
      occurrence: 0,
      line: 10,
      bodyHash: "h:render:0",
      change: "edited",
      complexity: 13,
      coverage: { lines: 10, covered: 5, share: 0.5 },
      crap: 34.125,
      state: "violation",
      gap: null,
      loaders: loaders(["test/a.test.ts"], ["test/a.test.ts"]),
    },
    {
      path: "src/a.ts",
      qualifiedName: "render.<map>",
      occurrence: 0,
      line: 12,
      bodyHash: "h:render.<map>:0",
      change: "added",
      complexity: 2,
      coverage: { lines: 3, covered: 3, share: 1 },
      crap: 2,
      state: "pass",
      gap: null,
      loaders: loaders(["test/a.test.ts"], ["test/a.test.ts"]),
    },
    {
      path: "src/b.ts",
      qualifiedName: "load",
      occurrence: 0,
      line: 1,
      bodyHash: "h:load:0",
      change: "edited",
      complexity: 6,
      coverage: null,
      crap: null,
      state: "incomplete",
      gap: "not-finished",
      loaders: loaders(["test/b.test.mts"], []),
    },
    {
      path: "src/c.ts",
      qualifiedName: "orphan",
      occurrence: 0,
      line: 3,
      bodyHash: "h:orphan:0",
      change: "edited",
      complexity: 2,
      coverage: null,
      crap: null,
      state: "incomplete",
      gap: "no-loader",
      loaders: loaders([], []),
    },
    {
      path: "test/a.test.ts",
      qualifiedName: "<callback>",
      occurrence: 0,
      line: 3,
      bodyHash: "h:<callback>:0",
      change: "edited",
      complexity: 1,
      coverage: null,
      crap: null,
      state: "skipped",
      gap: null,
      loaders: loaders([], []),
    },
  ],
  uncounted: [
    { path: "src/huge.ts", reason: "too-large", gap: "not-counted" },
    { path: "src/link.ts", reason: "unsupported", gap: "not-counted" },
  ],
  runs: [
    {
      runner: "vitest",
      selected: ["test/a.test.ts"],
      completed: ["test/a.test.ts"],
      notFinished: [],
      failed: [],
      durationMs: 1200,
    },
    {
      runner: "node-test",
      selected: ["test/b.test.mts"],
      completed: [],
      notFinished: ["test/b.test.mts"],
      failed: [],
      durationMs: 598_800,
    },
  ],
  verdict: "violations",
  counts: { pass: 2, violation: 1, incomplete: 2, skipped: 1, accepted: 0 },
};

const reversed = <T>(list: readonly T[]) => [...list].reverse();

describe("evaluate: the report", () => {
  it("is the golden squeal-code-gate/1 report", () => {
    expect(evaluate(CHANGED, EVIDENCE, SKIP_TESTS, VERSIONS, DURATIONS)).toEqual(GOLDEN);
  });

  it("is the same JSON for the same inputs, given twice or in another order", () => {
    const once = JSON.stringify(evaluate(CHANGED, EVIDENCE, SKIP_TESTS, VERSIONS, DURATIONS));
    const twice = JSON.stringify(evaluate(CHANGED, EVIDENCE, SKIP_TESTS, VERSIONS, DURATIONS));
    expect(twice).toBe(once);
    const shuffled: ChangedSet = {
      ...CHANGED,
      functions: reversed(CHANGED.functions),
      counted: reversed(CHANGED.counted),
      uncounted: reversed(CHANGED.uncounted),
    };
    const other: Evidence = { ...EVIDENCE, testFiles: reversed(EVIDENCE.testFiles) };
    expect(JSON.stringify(evaluate(shuffled, other, SKIP_TESTS, VERSIONS, DURATIONS))).toBe(once);
  });

  it("differs only in its times when the run is timed again", () => {
    const later = { createdAt: "2026-11-10T08:00:00.000Z", durationsMs: { vitest: 900 } };
    const report = evaluate(CHANGED, EVIDENCE, SKIP_TESTS, VERSIONS, later);
    const times = (r: GateReport) => ({
      ...r,
      createdAt: "",
      runs: r.runs.map((run) => ({ ...run, durationMs: null })),
    });
    expect(times(report)).toEqual(times(GOLDEN));
  });
});
