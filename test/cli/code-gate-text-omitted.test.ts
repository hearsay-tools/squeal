import { describe, expect, it } from "vitest";
import { formatGateReport } from "../../src/cli/code-gate-text.js";
import type { GateReport } from "../../src/core/code/gate/report.js";
import type { OmittedFunction } from "../../src/core/code/gate/types.js";

/*
 * Spec 020 D16.3 (row 020-18, #177): the verdict line ends with how many
 * changed functions D2 left out, and says nothing when none was.
 */

const pass = (name: string, line: number): GateReport["functions"][number] => ({
  path: "src/old.ts",
  qualifiedName: name,
  occurrence: 0,
  line,
  bodyHash: `h:${name}`,
  change: "edited",
  complexity: 1,
  coverage: { lines: 2, covered: 2, share: 1 },
  crap: 1,
  state: "pass",
  gap: null,
  loaders: { expected: ["test/old.test.ts"], measured: ["test/old.test.ts"] },
});

const moved = (name: string): OmittedFunction => ({
  path: "src/helpers.ts",
  qualifiedName: name,
  occurrence: 0,
  line: 1,
  reason: "moved",
  base: { path: "src/old.ts", qualifiedName: name, occurrence: 0 },
});

const report = (omitted: readonly OmittedFunction[] | undefined): GateReport => ({
  format: "squeal-code-gate/1",
  createdAt: "2026-11-11T00:00:00.000Z",
  versions: { squeal: "0", counter: 5, coverageProvider: 3, coverageRecord: 4, qualityPolicy: 4 },
  base: {
    ref: "HEAD",
    commit: "8b1af5bc0123",
    policy: {
      complexityThreshold: 20,
      crapThreshold: 30,
      coverageExclude: [],
      complexityInclude: ["**/*.ts"],
      complexityExclude: [],
      complexityMaxFileBytes: 524_288,
    },
  },
  head: { commit: "fedcba", dirty: true, paths: [] },
  budget: { seconds: 600, timedOut: false },
  functions: [pass("main", 2), pass("other", 9), pass("third", 14)],
  ...(omitted === undefined ? {} : { omitted }),
  uncounted: [],
  runs: [],
  verdict: "pass",
  counts: { pass: 3, violation: 0, incomplete: 0, skipped: 0, accepted: 0 },
});

const JSON_HINT = "squeal code --base HEAD --json";

describe("formatGateReport: the functions left out (spec 020 D16.3)", () => {
  it("ends the verdict line with their count, and lists none of them", () => {
    const left = ["clamp", "sign", "newName", "a", "b", "c", "d"].map(moved);
    expect(formatGateReport(report(left), JSON_HINT)).toBe(
      [
        "Code gate: pass. 3 changed functions against HEAD (merge base 8b1af5bc): 3 pass. 7 left out as moved or unchanged; --json lists them.",
        `JSON report: ${JSON_HINT}`,
        "",
      ].join("\n"),
    );
  });

  it("says nothing of them when there are none, or the report has no list", () => {
    const plain = [
      "Code gate: pass. 3 changed functions against HEAD (merge base 8b1af5bc): 3 pass.",
      `JSON report: ${JSON_HINT}`,
      "",
    ].join("\n");
    expect(formatGateReport(report([]), JSON_HINT)).toBe(plain);
    expect(formatGateReport(report(undefined), JSON_HINT)).toBe(plain);
  });
});
