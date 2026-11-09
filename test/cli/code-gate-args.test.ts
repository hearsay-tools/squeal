import { describe, expect, it } from "vitest";
import { DEFAULT_BUDGET_SECONDS, isGate, narrow, parseGateArgs } from "../../src/cli/code-gate.js";
import { crapText, formatGateReport } from "../../src/cli/code-gate-text.js";
import { main } from "../../src/cli/main.js";
import type { GateFunctionReport, GateReport } from "../../src/core/code/gate/report.js";
import type { ChangedSet } from "../../src/core/code/gate/types.js";
import { TEST_FLAG } from "./code-gate-fixture.js";

/*
 * Spec 020 D1 (row 020-05): the arguments of `squeal code --base`, the
 * narrowing by paths, and the text lines the end-to-end runs do not reach.
 */

describe("parseGateArgs (spec 020 D1)", () => {
  it("takes the ref, paths, --test files, the budget and --json", () => {
    expect(isGate(["src", "--base=origin/main"])).toBe(true);
    expect(isGate(["src", "--changed"])).toBe(false);
    expect(parseGateArgs(["--base", "origin/main"])).toEqual({
      ref: "origin/main",
      paths: [],
      tests: [],
      budgetSeconds: DEFAULT_BUDGET_SECONDS,
      json: false,
    });
    expect(
      parseGateArgs([
        "src",
        "lib/a.ts",
        "--base=main",
        TEST_FLAG,
        "test/a.test.ts",
        "test/b.test.ts",
        "--timeout",
        "90",
        `${TEST_FLAG}=test/c.test.ts`,
        "--json",
      ]),
    ).toEqual({
      ref: "main",
      paths: ["src", "lib/a.ts"],
      tests: ["test/a.test.ts", "test/b.test.ts", "test/c.test.ts"],
      budgetSeconds: 90,
      json: true,
    });
  });

  it.each([
    [["--base"], "--base names no ref"],
    [["--base", "--json"], "--base names no ref"],
    [["--base", "a", "--base", "b"], "--base is given twice"],
    [["--base", "main", "--changed"], "--base does not combine with --changed"],
    [["--base", "main", "--told"], "--base does not combine with --told"],
    [["--base", "main", "--timeout", "0"], "--timeout takes whole seconds above 0"],
    [["--base", "main", "--timeout", "1.5"], "--timeout takes whole seconds above 0"],
    [["--base", "main", "--timeout", "-5"], "--timeout takes whole seconds above 0"],
    [["--base", "main", "--timeout"], "--timeout takes whole seconds above 0"],
    [["--base", "main", TEST_FLAG], "--test names no file"],
    [["--base", "main", `${TEST_FLAG}=`], "--test names no file"],
    [["--base", "main", "--json=yes"], 'unknown option "--json=yes"'],
    [["--base", "main", "--all"], 'unknown option "--all"'],
  ])("refuses %j", (args, error) => {
    expect(parseGateArgs(args)).toEqual({ error: expect.stringContaining(error) });
  });
});

describe("narrow (spec 020 D1: paths narrow the changed functions)", () => {
  const fn = (path: string) => ({ path }) as ChangedSet["functions"][number];
  const changed = {
    ref: "main",
    baseCommit: "b",
    headCommit: "h",
    dirty: false,
    functions: [fn("src/a.ts"), fn("src2/b.ts"), fn("lib/c.ts")],
    counted: [{ path: "src/a.ts", blob: "x", functions: [] }],
    inErrors: [fn("lib/c.ts")],
    uncounted: [{ path: "src/big.ts", reason: "too-large" }],
  } as ChangedSet;

  it("keeps the files under each directory and each file named", () => {
    const narrowed = narrow(changed, ["src", "lib/c.ts"]);
    expect(narrowed.functions.map((f) => f.path)).toEqual(["src/a.ts", "lib/c.ts"]);
    expect(narrowed.counted.map((c) => c.path)).toEqual(["src/a.ts"]);
    expect(narrowed.inErrors.map((f) => f.path)).toEqual(["lib/c.ts"]);
    expect(narrowed.uncounted.map((u) => u.path)).toEqual(["src/big.ts"]);
  });

  it("keeps every path with none named, or with the worktree's top named", () => {
    expect(narrow(changed, [])).toBe(changed);
    expect(narrow(changed, [""]).functions).toHaveLength(3);
  });
});

describe("crapText (spec 020 D1: CRAP is rounded for display only)", () => {
  it.each([
    [42, 30, "42"],
    [34.567, 30, "34.6"],
    [30.04, 30, "30.04"],
    [30.0004, 30, "30.0004"],
    [29.96, 30, "30.0"],
  ])("shows %d against %d as %s", (value, limit, text) => {
    expect(crapText(value, limit)).toBe(text);
  });
});

const row = (over: Partial<GateFunctionReport>): GateFunctionReport => ({
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
});

const REPORT: GateReport = {
  format: "squeal-code-gate/1",
  createdAt: "2026-11-10T00:00:00.000Z",
  versions: { squeal: "0", counter: 3, coverageProvider: 3, coverageRecord: 4, qualityPolicy: 1 },
  base: {
    ref: "origin/main",
    commit: "0123456789abcdef",
    policy: { complexityThreshold: 20, crapThreshold: 30, coverageExclude: ["scripts/**"] },
  },
  head: { commit: "fedcba", dirty: true, paths: [] },
  budget: { seconds: 600, timedOut: true },
  functions: [
    row({ qualifiedName: "ok", state: "pass" }),
    row({ path: "scripts/run.ts", qualifiedName: "main", line: 4, state: "skipped" }),
    row({
      qualifiedName: "it.<callback>",
      occurrence: 1,
      line: 9,
      state: "incomplete",
      gap: "not-finished",
    }),
    row({
      qualifiedName: "covered",
      line: 20,
      coverage: { lines: 4, covered: 3, share: 0.75 },
      crap: 3.0469,
      state: "incomplete",
      gap: "test-failed",
    }),
  ],
  uncounted: [{ path: "src/big.ts", reason: "too-large", gap: "not-counted" }],
  runs: [
    {
      runner: "vitest",
      selected: ["test/a.test.ts", "test/slow.test.ts"],
      completed: ["test/a.test.ts"],
      notFinished: ["test/slow.test.ts"],
      failed: [{ path: "test/a.test.ts", tests: ["a", "b", "c", "d"] }],
      durationMs: 1200,
    },
  ],
  verdict: "incomplete",
  counts: { pass: 1, violation: 0, incomplete: 2, skipped: 1 },
};

describe("formatGateReport (spec 020 D1)", () => {
  it("prints the verdict, the functions that are not pass, the paths and runs, then the JSON command", () => {
    expect(formatGateReport(REPORT, "squeal code --base origin/main --json").split("\n")).toEqual([
      "Code gate: incomplete. 4 changed functions against origin/main (merge base 01234567): 2 incomplete, 1 skipped, 1 pass, 1 path not counted.",
      "  scripts/run.ts:4  main  CC 3: skipped: its file is in coverage.exclude",
      "  src/a.ts:9  it.<callback> (occurrence 2)  CC 3: incomplete: a test file that loads it did not finish in the budget",
      "  src/a.ts:20  covered  CC 3, coverage 75%, CRAP 3.0: incomplete: a selected test failed",
      "  src/big.ts: over complexity.maxFileBytes, not counted",
      "  test/a.test.ts: failed: a; b; c and 1 more",
      "  test/slow.test.ts: did not finish in the 600 s budget",
      "JSON report: squeal code --base origin/main --json",
      "",
    ]);
  });

  it("says no function changed when none did", () => {
    const empty = {
      ...REPORT,
      functions: [],
      uncounted: [],
      runs: [],
      verdict: "pass",
      counts: { pass: 0, violation: 0, incomplete: 0, skipped: 0 },
    } as const;
    expect(formatGateReport(empty, "squeal code --base main --json")).toBe(
      "Code gate: pass. No function changed against origin/main (merge base 01234567).\nJSON report: squeal code --base main --json\n",
    );
  });
});

describe("squeal --help (spec 020 D1)", () => {
  it("names squeal code --base after squeal code; its first line says it runs tests, with no daemon", () => {
    let out = "";
    const stdout = (text: string) => {
      out += text;
    };
    main(["--help"], { stdout, stderr: () => {} });
    const lines = out.split("\n");
    const gate = lines.indexOf(
      "  squeal code --base <ref> [<path>...] [--test <file>...] [--timeout <seconds>]",
    );
    expect(gate).toBeGreaterThan(
      lines.indexOf("  squeal code [<path>...] [--changed | --told] [--json]"),
    );
    expect(lines[gate + 1]?.trim()).toBe("[--json]");
    expect(lines[gate + 2]?.trim()).toMatch(/^Runs tests, with no daemon,/);
  });
});
