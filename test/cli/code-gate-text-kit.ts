import type { GateFunctionReport, GateReport } from "../../src/core/code/gate/report.js";

/*
 * Spec 020 D1: the reports the text tests of `squeal code --base` format.
 * The text reads the base's ref, commit and thresholds, the budget, the
 * functions, paths and runs; the other fields only make the report whole.
 */

/** A changed function: `f` at `src/a.ts:1`, edited, CC 3, no coverage, pass; `over` on top. */
export function functionRow(over: Partial<GateFunctionReport> = {}): GateFunctionReport {
  return {
    path: "src/a.ts",
    qualifiedName: "f",
    occurrence: 0,
    line: 1,
    bodyHash: "h",
    change: "edited",
    complexity: 3,
    coverage: null,
    crap: null,
    state: "pass",
    gap: null,
    loaders: { expected: [], measured: [] },
    ...over,
  };
}

export interface ReportOver extends Partial<Omit<GateReport, "base">> {
  /** Merged over the default base: its ref, its commit or its policy. */
  readonly base?: Partial<GateReport["base"]>;
}

/**
 * A pass with no changed function, path or run, against `origin/main` at
 * merge base `0123456789abcdef`, thresholds CC 20 and CRAP 30, a 600 s
 * budget; `over` on top.
 */
export function gateReport(over: ReportOver = {}): GateReport {
  const { base, ...rest } = over;
  return {
    format: "squeal-code-gate/1",
    createdAt: "2026-11-10T00:00:00.000Z",
    versions: { squeal: "0", counter: 5, coverageProvider: 3, coverageRecord: 4, qualityPolicy: 4 },
    base: {
      ref: "origin/main",
      commit: "0123456789abcdef",
      policy: {
        complexityThreshold: 20,
        crapThreshold: 30,
        coverageExclude: [],
        complexityInclude: ["**/*.ts"],
        complexityExclude: [],
        complexityMaxFileBytes: 524_288,
      },
      ...base,
    },
    head: { commit: "fedcba", dirty: true, paths: [] },
    budget: { seconds: 600, timedOut: false },
    functions: [],
    uncounted: [],
    runs: [],
    verdict: "pass",
    counts: { pass: 0, violation: 0, incomplete: 0, skipped: 0, accepted: 0 },
    ...rest,
  };
}
