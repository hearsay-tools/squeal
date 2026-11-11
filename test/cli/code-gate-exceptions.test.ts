import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { formatGateReport } from "../../src/cli/code-gate-text.js";
import { countFile } from "../../src/core/code/count/index.js";
import type {
  GateExceptionUse,
  GateFunctionReport,
  GateReport,
} from "../../src/core/code/gate/report.js";
import { type ExceptionEntry, QUALITY_POLICY_VERSION } from "../../src/core/code/gate/types.js";
import { git } from "../hash/git-repo.js";
import { BASE, code, edit, noEstimate, ownHomeAndTmp, repo, SLOW } from "./code-gate-fixture.js";

/*
 * Spec 020 D8 (row 020-09): `squeal code --base <ref> --exceptions <file>`
 * end to end, in a temporary git repository with no daemon, and the text
 * lines of exceptions. The file is the consumer's: Squeal applies it and
 * keeps the measured scores.
 */

/** `deep` with `ifs` decisions: CC `ifs + 1`. A test calls it with 100, so every line runs. */
const deep = (ifs: number, tail = "n") => `export function deep(x: number): number {
  let n = 0;
${Array.from({ length: ifs }, (_, i) => `  if (x > ${i}) n++;`).join("\n")}
  return ${tail};
}
`;

/** The base: `double` and `deep` at CC 21, over the limit of 20, both tested. */
const OVER_AT_BASE: Readonly<Record<string, string>> = {
  ...BASE,
  "src/math.ts": `${BASE["src/math.ts"]}\n${deep(20)}`,
  "test/math.test.ts": `import { expect, it } from "vitest";\nimport { deep, double } from "../src/math";\n\nit("doubles", () => expect(double(2)).toBe(4));\nit("counts", () => expect(deep(100)).toBe(20));\n`,
};

/**
 * Writes the head's `src/math.ts`, and an exceptions file naming its `deep`
 * at the merge base under `.git/`, which git does not list as a change.
 */
async function headWithException(
  root: string,
  text: string,
  over: Partial<ExceptionEntry>,
): Promise<string> {
  edit(root, { "src/math.ts": text });
  const count = await countFile(text, "typescript");
  const bodyHash = count.functions.find((f) => f.qualifiedName === "deep")?.bodyHash;
  const file = join(root, ".git", "exceptions.json");
  const entry = {
    path: "src/math.ts",
    qualifiedName: "deep",
    bodyHash,
    measure: "complexity",
    kind: "inherited",
    value: 21,
    issue: "https://github.com/o/r/issues/167",
    approver: "owner",
    baseCommit: git(root, ["rev-parse", "main"]).trim(),
    ...over,
  };
  writeFileSync(file, JSON.stringify({ format: "squeal-code-exceptions/1", entries: [entry] }));
  return file;
}

const functionsOf = (stdout: string) =>
  (JSON.parse(stdout) as GateReport).functions.map((f) => [
    f.qualifiedName,
    f.complexity,
    f.crap,
    f.state,
    f.exceptions?.map((u) => [u.outcome, u.baseComplexity]),
  ]);

describe("squeal code --base --exceptions (spec 020 D8)", () => {
  it("exits 0 when an inherited CC exception covers a function not made worse", SLOW, async () => {
    ownHomeAndTmp();
    const root = repo(OVER_AT_BASE);
    const file = await headWithException(root, `${BASE["src/math.ts"]}\n${deep(20, "n + 0")}`, {});

    const ran = await code(root, ["--base", "main", "--exceptions", file, "--json"]);

    expect(ran.stderr).toBe(
      `squeal code: Vitest: 1 test file to run (tests 1)\n${noEstimate("Vitest", 1)}`,
    );
    expect(ran.code).toBe(0);
    expect(functionsOf(ran.stdout)).toEqual([["deep", 21, 21, "accepted", [["covers", 21]]]]);
    const report = JSON.parse(ran.stdout) as GateReport;
    expect([report.verdict, report.counts.accepted, report.exceptions]).toEqual([
      "pass",
      1,
      { unused: [] },
    ]);
    expect(report.versions.qualityPolicy).toBe(QUALITY_POLICY_VERSION);
  });

  it("exits 1 when the function got worse than at the base", SLOW, async () => {
    ownHomeAndTmp();
    const root = repo(OVER_AT_BASE);
    const file = await headWithException(root, `${BASE["src/math.ts"]}\n${deep(21)}`, {
      value: 22,
    });

    const ran = await code(root, ["--base", "main", "--exceptions", file]);

    expect(ran.code).toBe(1);
    expect(ran.stdout.split("\n").slice(0, 2)).toEqual([
      expect.stringMatching(
        /^Code gate: violations\. 1 changed function against main .*: 1 violation\.$/,
      ),
      "  src/math.ts:5  deep  CC 22 over 20, coverage 100%, CRAP 22: violation; inherited complexity exception does not cover it: CC is over the base's 21",
    ]);
  });

  it.each([
    ["{ not json", /: not JSON: /],
    [
      `{"format":"squeal-code-exceptions/2","entries":[]}`,
      /: format is "squeal-code-exceptions\/2", not "squeal-code-exceptions\/1"$/,
    ],
    [
      `{"format":"squeal-code-exceptions/1","entries":[{"path":"a.ts"}]}`,
      /: entry 1: qualifiedName is not a non-empty string$/,
    ],
  ])(
    "exits 2 for a file that is not an exceptions file, and runs nothing: %s",
    SLOW,
    async (text, error) => {
      const leftInTmp = ownHomeAndTmp();
      const root = repo();
      const file = join(root, ".git", "bad.json");
      writeFileSync(file, text);

      const ran = await code(root, ["--base", "main", "--exceptions", file]);

      expect([ran.code, ran.stdout]).toEqual([2, ""]);
      expect(ran.stderr.trimEnd()).toMatch(error);
      expect(ran.stderr).toContain(`squeal code: --exceptions ${file}`);
      expect(leftInTmp()).toEqual([]);
    },
  );

  it("exits 2 for an exceptions file that does not exist", SLOW, async () => {
    ownHomeAndTmp();
    const root = repo();
    const ran = await code(root, ["--base", "main", "--exceptions", "nope.json"]);
    expect(ran).toEqual({
      code: 2,
      stdout: "",
      stderr: "squeal code: --exceptions nope.json: cannot be read: ENOENT\n",
    });
  });
});

const row = (
  over: Partial<GateFunctionReport>,
  exceptions: readonly GateExceptionUse[],
): GateFunctionReport => ({
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
  exceptions,
});

const REPORT: GateReport = {
  format: "squeal-code-gate/1",
  createdAt: "2026-11-10T00:00:00.000Z",
  versions: { squeal: "0", counter: 3, coverageProvider: 3, coverageRecord: 4, qualityPolicy: 2 },
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
  },
  head: { commit: "fedcba", dirty: true, paths: [] },
  budget: { seconds: 600, timedOut: false },
  functions: [],
  uncounted: [],
  runs: [],
  verdict: "pass",
  counts: { pass: 0, violation: 0, incomplete: 0, skipped: 0, accepted: 0 },
};

describe("formatGateReport: exceptions (spec 020 D8)", () => {
  const entry = (over: Partial<ExceptionEntry>): ExceptionEntry => ({
    path: "src/a.ts",
    qualifiedName: "f",
    bodyHash: "h",
    measure: "complexity",
    kind: "inherited",
    value: 22,
    issue: "https://github.com/o/r/issues/7",
    approver: "owner",
    baseCommit: "0123456789abcdef",
    ...over,
  });
  const use = (
    entry: ExceptionEntry,
    outcome: GateExceptionUse["outcome"],
    baseComplexity: number | null,
  ): GateExceptionUse => ({ entry, outcome, baseComplexity });
  const kept = entry({ qualifiedName: "kept" });
  const fresh = entry({ qualifiedName: "fresh", measure: "crap", kind: "approved", value: 42 });

  it("names the entry of each accepted function, why one does not cover a violation, and the unused", () => {
    const report: GateReport = {
      ...REPORT,
      functions: [
        row({ qualifiedName: "kept", complexity: 22, state: "accepted", line: 2 }, [
          use(kept, "covers", 22),
        ]),
        row(
          {
            qualifiedName: "fresh",
            line: 3,
            complexity: 6,
            coverage: { lines: 4, covered: 0, share: 0 },
            crap: 42,
            state: "accepted",
          },
          [use(fresh, "covers", null)],
        ),
        row({ qualifiedName: "grown", complexity: 23, state: "violation", line: 4 }, [
          use(entry({ qualifiedName: "grown" }), "worse-than-base", 22),
        ]),
        row({ qualifiedName: "cleaned", complexity: 21, state: "violation", line: 5 }, [
          use(entry({ qualifiedName: "cleaned" }), "not-over-at-base", 20),
        ]),
        row({ qualifiedName: "stale", complexity: 21, state: "violation", line: 6 }, [
          use(entry({ qualifiedName: "stale", value: 25 }), "over-value", 30),
        ]),
        row({ qualifiedName: "moved", complexity: 26, state: "violation", line: 7 }, [
          use(entry({ qualifiedName: "moved" }), "not-at-base", null),
          use(entry({ qualifiedName: "moved", kind: "approved", value: 25 }), "over-value", null),
        ]),
      ],
      uncounted: [],
      exceptions: {
        unused: [
          { entry: entry({ qualifiedName: "old" }), why: "base-commit" },
          { entry: entry({ qualifiedName: "kept", bodyHash: "x" }), why: "body-hash" },
        ],
      },
      runs: [],
      verdict: "violations",
      counts: { pass: 0, violation: 4, incomplete: 0, skipped: 0, accepted: 2 },
    };
    expect(formatGateReport(report, "j").split("\n")).toEqual([
      "Code gate: violations. 6 changed functions against origin/main (merge base 01234567): 4 violations, 2 accepted, 2 exceptions unused.",
      "  src/a.ts:2  kept  CC 22 over 20: accepted: inherited complexity exception, https://github.com/o/r/issues/7",
      "  src/a.ts:3  fresh  CC 6, coverage 0%, CRAP 42 over 30: accepted: approved crap exception, https://github.com/o/r/issues/7",
      "  src/a.ts:4  grown  CC 23 over 20: violation; inherited complexity exception does not cover it: CC is over the base's 22",
      "  src/a.ts:5  cleaned  CC 21 over 20: violation; inherited complexity exception does not cover it: CC 20 at the base is not over 20",
      "  src/a.ts:6  stale  CC 21 over 20: violation; inherited complexity exception does not cover it: CC 30 at the base is over its value 25",
      "  src/a.ts:7  moved  CC 26 over 20: violation; inherited complexity exception does not cover it: the function is not at the base; approved complexity exception does not cover it: CC is over its value 25",
      "  inherited complexity exception for src/a.ts old: unused: its base commit is not the merge base",
      "  inherited complexity exception for src/a.ts kept: unused: the changed function of that name has another body hash",
      "JSON report: j",
      "",
    ]);
  });
});
