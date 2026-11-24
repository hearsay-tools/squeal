import { describe, expect, it } from "vitest";
import { CODE_GATE_USAGE, parseGateArgs } from "../../../src/cli/code-gate-args.js";
import { formatGateReport } from "../../../src/cli/code-gate-text.js";
import { leftOutFailures } from "../../../src/core/code/gate/left-out-stored.js";
import { narrowRun } from "../../../src/core/code/gate/narrow.js";
import type { GateReport } from "../../../src/core/code/gate/report.js";
import {
  type LeftOutGroup,
  readScope,
  resolveScope,
  type ScopeGroup,
  tallyScope,
} from "../../../src/core/code/gate/scope.js";
import type { TestFileEvidence } from "../../../src/core/code/gate/types.js";
import type { CheckGroup } from "../../../src/core/types/check-groups.js";
import type { RelativePath } from "../../../src/core/types/common.js";
import type { TestFileRef } from "../../../src/core/types/keys.js";
import { DEFAULT_POLICY, type Policy } from "../../../src/core/types/policy.js";
import type { AffectedTestFiles } from "../../../src/core/types/runner.js";
import { functionRow, gateReport } from "../../cli/code-gate-text-kit.js";

/*
 * Spec 026 D5 (row 026-08): `squeal code --base` under a tiered policy.
 * `--narrow` keeps 019 D6's narrow set; with no test group in scope the
 * verdict line says so; a current stored failure in a left-out file is named.
 */

const ref = (path: string): TestFileRef => ({ project: "", path: path as RelativePath });
const paths = (refs: readonly TestFileRef[]) => refs.map((r) => r.path);

/** An adapter whose `affected` answers from `graph`, per changed source. */
function adapter(graph: Record<string, { direct?: string[]; transitive?: string[] }>) {
  const asked: string[][] = [];
  return {
    asked,
    affected: async (changed: readonly RelativePath[]): Promise<AffectedTestFiles> => {
      asked.push([...changed]);
      const direct = changed.flatMap((p) => graph[p]?.direct ?? []).map(ref);
      const transitive = changed.flatMap((p) => graph[p]?.transitive ?? []).map(ref);
      return { direct, transitive } as AffectedTestFiles;
    },
  };
}

describe("narrowRun: 019 D6's narrow set among the files the scope runs (spec 026 D5.2)", () => {
  const listed = [
    "test/a.test.ts",
    "test/b.test.ts",
    "test/c.test.ts",
    "test/d.test.ts",
    "test/e.test.ts",
  ].map(ref);

  it("keeps the namesake and drops the other direct and transitive importers past tierSize", async () => {
    const a = adapter({
      "src/a.ts": {
        direct: ["test/a.test.ts", "test/b.test.ts", "test/c.test.ts"],
        transitive: ["test/d.test.ts"],
      },
    });
    const durations = (r: TestFileRef) => (r.path === "test/c.test.ts" ? 1 : null);
    const { kept, dropped } = await narrowRun({
      adapter: a,
      listed,
      run: listed.slice(0, 4),
      paths: ["src/a.ts" as RelativePath],
      tests: [],
      tierSize: 1,
      durations,
    });
    expect(paths(kept)).toEqual(["test/a.test.ts", "test/c.test.ts"]);
    expect(paths(dropped)).toEqual(["test/b.test.ts", "test/d.test.ts"]);
    expect(a.asked).toEqual([["src/a.ts"]]);
  });

  it("falls back to every direct importer for a source with no namesake, and keeps changed and --test files", async () => {
    const a = adapter({ "src/x.ts": { direct: ["test/b.test.ts", "test/c.test.ts"] } });
    const { kept, dropped } = await narrowRun({
      adapter: a,
      listed,
      run: listed,
      paths: ["src/x.ts", "test/e.test.ts"] as RelativePath[],
      tests: ["test/d.test.ts" as RelativePath],
      tierSize: 0,
    });
    expect(paths(kept)).toEqual([
      "test/b.test.ts",
      "test/c.test.ts",
      "test/d.test.ts",
      "test/e.test.ts",
    ]);
    expect(paths(dropped)).toEqual(["test/a.test.ts"]);
  });

  it("keeps nothing outside the files the scope runs", async () => {
    const a = adapter({ "src/a.ts": { direct: ["test/a.test.ts", "test/b.test.ts"] } });
    const run = [ref("test/b.test.ts")];
    const narrowed = await narrowRun({
      adapter: a,
      listed,
      run,
      paths: ["src/a.ts" as RelativePath],
      tests: [],
      tierSize: 0,
    });
    // The namesake is out of scope, so the source falls back to its direct importers in scope.
    expect(paths(narrowed.kept)).toEqual(["test/b.test.ts"]);
    expect(narrowed.dropped).toEqual([]);
  });

  it("gives each group its own tierSize places, a stored run read after the importers (row 026-21)", async () => {
    const graph = {
      "src/a.ts": { direct: ["test/a.test.ts", "test/b.test.ts", "test/d.test.ts"] },
    };
    const seconds: Record<string, number> = { "test/b.test.ts": 1, "test/d.test.ts": 2 };
    const narrow = (tierSize: number, groupOf?: (r: TestFileRef) => string) =>
      narrowRun({
        adapter: adapter({
          "src/a.ts": { ...graph["src/a.ts"], transitive: ["test/c.test.ts"] },
        }),
        listed,
        run: listed,
        paths: ["src/a.ts" as RelativePath],
        tests: [],
        tierSize,
        durations: (r) => seconds[r.path] ?? 0.1,
        observed: {
          directOf: () => [],
          readsOf: (r) => (r.path === "test/e.test.ts" ? ["src/a.ts" as RelativePath] : []),
        },
        ...(groupOf === undefined ? {} : { groupOf }),
      });
    // One group: the shortest other direct importer leads the shorter readers.
    expect(paths((await narrow(1)).kept)).toEqual(["test/a.test.ts", "test/b.test.ts"]);
    // The readers in a group of their own take that group's place: the shortest by name, c.
    const browser = (r: TestFileRef) =>
      ["test/c.test.ts", "test/e.test.ts"].includes(r.path) ? "browser" : "unit";
    expect(paths((await narrow(1, browser)).kept)).toEqual([
      "test/a.test.ts",
      "test/b.test.ts",
      "test/c.test.ts",
    ]);
    // The stored read counts as a reader once the places reach it.
    expect(paths((await narrow(3)).kept)).toEqual([
      "test/a.test.ts",
      "test/b.test.ts",
      "test/c.test.ts",
      "test/d.test.ts",
    ]);
    expect(paths((await narrow(4)).kept)).toContain("test/e.test.ts");
  });
});

const BROWSER: CheckGroup = { name: "browser", runner: "vitest", project: "browser", at: "manual" };
/** Every other Vitest file: the default groups own none. */
const UNIT: CheckGroup = { name: "unit", runner: "vitest", at: "manual" };

/** Every test file in a `manual` group, as a tiered policy keeps them. */
function tiered(groups: readonly string[] | null = null): Policy {
  return { ...DEFAULT_POLICY, checks: [BROWSER, UNIT], gate: { groups } };
}

function scopeNames(p: Policy, added: readonly string[], narrow: boolean) {
  const scope = resolveScope(readScope(p).base, added, narrow);
  if ("error" in scope) throw new Error(scope.error);
  return scope.inScope.map((g) => [g.name, g.from]);
}

describe("resolveScope with --narrow (spec 026 D5.2)", () => {
  it("leaves every manual group out without --narrow", () => {
    expect(scopeNames(tiered(), [], false)).toEqual([
      ["tests", "default"],
      ["slow", "default"],
    ]);
  });

  it("takes every test group with --narrow alone, manual included", () => {
    expect(scopeNames(tiered(), [], true)).toEqual([
      ["browser", "--narrow"],
      ["unit", "--narrow"],
      ["tests", "--narrow"],
      ["slow", "--narrow"],
    ]);
  });

  it("takes only the --group groups with --narrow --group", () => {
    expect(scopeNames(tiered(["unit"]), ["browser"], true)).toEqual([["browser", "--group"]]);
  });

  it("keeps gate.groups with --narrow alone when it is set", () => {
    expect(scopeNames(tiered(["unit"]), [], true)).toEqual([["unit", "gate.groups"]]);
  });
});

describe("tallyScope: no test file in scope (spec 026 D5.1)", () => {
  const files = [ref("test/a.test.ts"), ref("test/b.test.ts")];

  function evidenceOf(narrow: boolean) {
    const scope = resolveScope(readScope(tiered()).base, [], narrow);
    if ("error" in scope) throw new Error(scope.error);
    const tally = tallyScope(scope);
    tally.split("vitest", files, files, new Set());
    return tally.evidence([]);
  }

  it("marks the scope when the default groups own none of the listed files", () => {
    expect(evidenceOf(false).noTestFilesInScope).toBe(true);
    expect(evidenceOf(false).leftOut.map((g) => [g.name, g.files, g.selected])).toEqual([
      ["unit", 2, 2],
    ]);
  });

  it("does not mark it when a group in scope owns one", () => {
    expect(evidenceOf(true)).not.toHaveProperty("noTestFilesInScope");
  });
});

describe("parseGateArgs: --narrow (spec 026 D5.2)", () => {
  it("reads --narrow beside --group, and the usage names it", () => {
    expect(parseGateArgs(["--base", "main", "--narrow", "--group", "unit"])).toMatchObject({
      narrow: true,
      groups: ["unit"],
    });
    expect(parseGateArgs(["--base", "main"])).not.toHaveProperty("narrow");
    expect(CODE_GATE_USAGE).toContain("[--narrow]");
  });
});

const MANUAL = (name: string, selected: number): LeftOutGroup => ({
  name,
  at: "manual",
  files: 10,
  selected,
  add: `--group ${name}`,
});

const leftOutSource = functionRow({
  qualifiedName: "render",
  state: "incomplete",
  gap: "left-out",
  loaders: { expected: [], measured: [], leftOut: ["test/render.test.ts"] },
});

function report(scope: NonNullable<GateReport["scope"]>): GateReport {
  return gateReport({
    verdict: "incomplete",
    functions: [leftOutSource],
    counts: { pass: 0, violation: 0, incomplete: 1, skipped: 0, accepted: 0 },
    scope,
  });
}

const verdictLine = (r: GateReport) => formatGateReport(r, "j").split("\n")[0] ?? "";

describe("the verdict line under a tiered policy (spec 026 D5.1)", () => {
  it("says 0 test groups are in scope and names --group, --narrow and gate.groups", () => {
    const line = verdictLine(report({ groups: [], leftOut: [MANUAL("tests", 3)] }));
    expect(line).toMatch(
      /^Code gate: incomplete \(0 test groups in scope; groups left out: tests \(manual\); add --group <name>, use --narrow, or set gate\.groups\)\. 1 changed function/,
    );
  });

  it("says it too when the groups in scope own no test file", () => {
    const groups: ScopeGroup[] = [{ name: "tests", at: "edit", from: "default" }];
    const line = verdictLine(
      report({ groups, leftOut: [MANUAL("unit", 3)], noTestFilesInScope: true }),
    );
    expect(line).toMatch(
      /^Code gate: incomplete \(0 test groups in scope; groups left out: unit \(manual\);/,
    );
  });

  it("says nothing of it when a group is in scope", () => {
    const groups: ScopeGroup[] = [{ name: "tests", at: "edit", from: "default" }];
    expect(verdictLine(report({ groups, leftOut: [] }))).toMatch(/^Code gate: incomplete\. /);
  });

  it("names a current stored failure of a left-out loader", () => {
    const line = verdictLine(
      report({
        groups: [],
        leftOut: [MANUAL("tests", 1)],
        leftOutFailures: [
          {
            runner: "vitest",
            path: "test/render.test.ts" as RelativePath,
            group: "tests",
            tests: ["renders"],
          },
        ],
      }),
    );
    expect(line).toMatch(
      / A left-out test file fails in the stores at this head, not run here: test\/render\.test\.ts \(1 failed test; --group tests runs it\)\.$/,
    );
  });

  it("says what --narrow left out in scope", () => {
    const groups: ScopeGroup[] = [{ name: "tests", at: "manual", from: "--narrow" }];
    expect(verdictLine(report({ groups, leftOut: [], narrowed: 2 }))).toMatch(
      / --narrow left out 2 other selected test files in scope: they did not run, and the functions they load stay incomplete; drop --narrow to run them\.$/,
    );
  });
});

describe("leftOutFailures: the stores' current failures of left-out files (spec 026 D5.1)", () => {
  const evidence = (failed: string[]) => ({ failed }) as unknown as TestFileEvidence;

  it("keeps the failed ones with their group, and asks only for left-out files", async () => {
    const [a, b] = [ref("test/a.test.ts"), ref("test/b.test.ts")];
    const asked: string[] = [];
    const picked = [
      {
        kind: "vitest" as const,
        adapter: {} as never,
        listed: [a, b],
        run: [ref("test/run.test.ts")],
        leftOut: [
          { ref: a, group: "tests" },
          { ref: b, group: "browser" },
        ],
      },
    ];
    const failures = await leftOutFailures(picked, async (_runner, files) => {
      asked.push(...files.map((f) => f.path));
      return new Map([
        [a, evidence(["z", "a"])],
        [b, evidence([])],
      ]);
    });
    expect(asked).toEqual(["test/a.test.ts", "test/b.test.ts"]);
    expect(failures).toEqual([
      { runner: "vitest", path: "test/a.test.ts", group: "tests", tests: ["a", "z"] },
    ]);
  });

  it("gives none without a lookup, or when the lookup rejects", async () => {
    const picked = [
      {
        kind: "vitest" as const,
        adapter: {} as never,
        listed: [],
        run: [],
        leftOut: [{ ref: ref("test/a.test.ts"), group: "tests" }],
      },
    ];
    expect(await leftOutFailures(picked, undefined)).toEqual([]);
    expect(await leftOutFailures(picked, () => Promise.reject(new Error("locked")))).toEqual([]);
  });
});
