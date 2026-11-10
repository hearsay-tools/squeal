import { describe, expect, it } from "vitest";
import { FILE_ERROR } from "../../src/core/code/gate/collect.js";
import type { GateReport } from "../../src/core/code/gate/report.js";
import { gitHashObject } from "../hash/git-repo.js";
import { BASE, code, edit, ownHomeAndTmp, repo, SLOW } from "./code-gate-fixture.js";

/*
 * Spec 020 D1 (row 020-05): `squeal code --base <ref>` end to end, in a
 * temporary git repository with no daemon: the changed functions against
 * the merge base, measured by a one-shot Vitest run, and one verdict as the
 * exit code: 0 pass, 1 violations, 3 incomplete, 2 usage or setup error.
 */

describe("squeal code --base: pass (spec 020 D1, exit 0)", () => {
  it("exits 0 when the one changed function passes, and --json is the report", SLOW, async () => {
    const leftInTmp = ownHomeAndTmp();
    const root = repo();
    edit(root, {
      "src/math.ts": "export function double(x: number): number {\n  return x + x;\n}\n",
    });

    const ran = await code(root, ["--base", "main", "--json"]);

    expect(ran.stderr).toBe("");
    expect(ran.code).toBe(0);
    const report = JSON.parse(ran.stdout) as GateReport;
    expect(report.format).toBe("squeal-code-gate/1");
    expect(report.verdict).toBe("pass");
    expect(report.base.ref).toBe("main");
    expect(report.head.dirty).toBe(true);
    expect(report.functions.map((f) => [f.path, f.qualifiedName, f.state, f.crap])).toEqual([
      ["src/math.ts", "double", "pass", 1],
    ]);
    expect(report.functions[0]?.loaders.measured).toEqual(["test/math.test.ts"]);
    expect(report.runs.map((r) => [r.runner, r.completed])).toEqual([
      ["vitest", ["test/math.test.ts"]],
    ]);
    expect(report.runs[0]?.durationMs).toBeGreaterThan(0);
    expect(leftInTmp()).toEqual([]);
  });
});

/** `deep` is CC 21; `untested` is CC 6 and no test calls it: CRAP 6² + 6 = 42. */
const OVER = `${BASE["src/math.ts"]}
export function deep(x: number): number {
  let n = 0;
${Array.from({ length: 20 }, (_, i) => `  if (x > ${i}) n++;`).join("\n")}
  return n;
}

export function untested(x: number): number {
  if (x > 1) return 1;
  if (x > 2) return 2;
  if (x > 3) return 3;
  if (x > 4) return 4;
  if (x > 5) return 5;
  return 0;
}
`;

describe("squeal code --base: violations (spec 020 D1, D6, exit 1)", () => {
  it("judges by the base's limits when the branch raises its own", SLOW, async () => {
    ownHomeAndTmp();
    const root = repo();
    edit(root, {
      "src/math.ts": OVER,
      "squeal.config.json": JSON.stringify({
        complexity: { threshold: 50 },
        crap: { threshold: 100 },
      }),
    });

    const ran = await code(root, ["--base", "main"]);

    expect(ran.code).toBe(1);
    const lines = ran.stdout.trimEnd().split("\n");
    expect(lines[0]).toMatch(
      /^Code gate: violations\. 2 changed functions against main \(merge base [0-9a-f]{8}\): 2 violations\.$/,
    );
    expect(lines.slice(1)).toEqual([
      "  src/math.ts:5  deep  CC 21 over 20, coverage 0%, CRAP 462 over 30: violation",
      "  src/math.ts:30  untested  CC 6, coverage 0%, CRAP 42 over 30: violation",
      "JSON report: squeal code --base main --json",
    ]);
  });
});

describe("squeal code --base: incomplete (spec 020 D1, D5, exit 3)", () => {
  it("reads incomplete for a changed file no test loads, and paths narrow", SLOW, async () => {
    ownHomeAndTmp();
    const root = repo({ ...BASE, "squeal.config.json": `{ "nope": 1 }\n` });
    edit(root, {
      "src/math.ts": "export function double(x: number): number {\n  return x + x;\n}\n",
      "src/orphan.ts": "export function lonely(): number {\n  return 1;\n}\n",
    });

    const whole = await code(root, ["--base", "main"]);

    expect(whole.code).toBe(3);
    const lines = whole.stdout.trimEnd().split("\n");
    expect(lines[0]).toMatch(
      /^Code gate: incomplete\. 2 changed functions against main .*: 1 incomplete, 1 pass\.$/,
    );
    expect(lines.slice(1)).toEqual([
      "  src/orphan.ts:1  lonely  CC 1: incomplete: no test loads its file",
      "JSON report: squeal code --base main --json",
    ]);
    // D1: policy problems go to stderr, never into the report.
    expect(whole.stderr).toMatch(/squeal code: squeal\.config\.json at [0-9a-f]{8}: .*nope/);
    expect(whole.stdout).not.toContain("nope");

    const narrowed = await code(root, ["src", "--base", "main", "--json"]);
    expect(narrowed.code).toBe(3);
    const only = await code(root, ["src/math.ts", "--base", "main", "--json"]);
    expect(only.code).toBe(0);
    const report = JSON.parse(only.stdout) as GateReport;
    expect(report.functions.map((f) => f.path)).toEqual(["src/math.ts"]);
    expect(report.head.paths.map((p) => p.path)).toEqual(["src/math.ts"]);
  });
});

describe("squeal code --base: usage and setup errors (spec 020 D1, exit 2)", () => {
  it("exits 2 for a ref that names no commit, and runs nothing", SLOW, async () => {
    ownHomeAndTmp();
    const root = repo();
    const ran = await code(root, ["--base", "no-such-ref"]);
    expect(ran).toEqual({
      code: 2,
      stdout: "",
      stderr: `squeal code: --base "no-such-ref" names no commit\n`,
    });
  });

  it("exits 2 for a --test path no runner lists", SLOW, async () => {
    const leftInTmp = ownHomeAndTmp();
    const root = repo();
    const ran = await code(root, ["--base", "main", "--test", "test/nope.test.ts"]);
    expect(ran.code).toBe(2);
    expect(ran.stdout).toBe("");
    expect(ran.stderr).toContain(
      "--test test/nope.test.ts: no Vitest or node:test project lists it",
    );
    expect(leftInTmp()).toEqual([]);
  });

  it.each([["--changed"], ["--told"]])("exits 2 for --base with %s", async (flag) => {
    const root = repo();
    const ran = await code(root, ["--base", "main", flag]);
    expect(ran.code).toBe(2);
    expect(ran.stdout).toBe("");
    expect(ran.stderr).toContain(`--base does not combine with ${flag}`);
    expect(ran.stderr).toContain(
      "Usage: squeal code --base <ref> [<path>...] [--test <file>...] [--timeout <seconds>] [--exceptions <file>] [--json]",
    );
  });
});

/*
 * Review 0.1.423 B1 (spec 020 D3.1, amended 2026-11-10): a changed test
 * file is selected whether or not a function of it changed.
 */
describe("squeal code --base: a changed test file always runs (spec 020 D3.1)", () => {
  it("runs a test file changed only at top level, and its failure exits 3", SLOW, async () => {
    ownHomeAndTmp();
    const root = repo();
    edit(root, {
      "test/math.test.ts": `${BASE["test/math.test.ts"]}throw new Error("changed test fails at top level");\n`,
    });

    const ran = await code(root, ["--base", "main", "--json"]);

    expect(ran.code).toBe(3);
    const report = JSON.parse(ran.stdout) as GateReport;
    expect(report.verdict).toBe("incomplete");
    expect(report.functions).toEqual([]);
    expect(report.runs.map((r) => [r.runner, r.selected, r.failed])).toEqual([
      ["vitest", ["test/math.test.ts"], [{ path: "test/math.test.ts", tests: [FILE_ERROR] }]],
    ]);
  });

  it("runs a test file whose callbacks only moved, and its failure exits 3", SLOW, async () => {
    ownHomeAndTmp();
    const sets = `it("sets", () => {\n  n = 1;\n});\n`;
    const reads = `it("reads", () => {\n  expect(n).toBe(1);\n});\n`;
    const head = `import { expect, it } from "vitest";\n\nlet n = 0;\n`;
    const root = repo({ ...BASE, "test/order.test.ts": `${head}${sets}${reads}` });
    // The same callbacks, swapped: no function changed, but "reads" now runs first and fails.
    edit(root, { "test/order.test.ts": `${head}${reads}${sets}` });

    const ran = await code(root, ["--base", "main", "--json"]);

    expect(ran.code).toBe(3);
    const report = JSON.parse(ran.stdout) as GateReport;
    expect(report.functions).toEqual([]);
    expect(report.runs.map((r) => [r.selected, r.completed, r.failed])).toEqual([
      [
        ["test/order.test.ts"],
        ["test/order.test.ts"],
        [{ path: "test/order.test.ts", tests: ["reads"] }],
      ],
    ]);
  });
});

/** Room for a loaded host to start Vitest and complete `test/math.test.ts` in the budget. */
const BUDGET = "15";

/**
 * Review 0.1.423 B2: `test/math.test.ts` completes; `test/slow.test.ts` runs
 * `first`, then sleeps past the budget. The project's own `testTimeout` is
 * longer than the budget, so only the budget stops it.
 */
function slowRepo(first: string): string {
  const root = repo({
    ...BASE,
    "vitest.config.ts": `import { defineConfig } from "vitest/config";\n\nexport default defineConfig({ test: { include: ["test/**/*.test.ts"], testTimeout: 600_000, maxWorkers: 2 } });\n`,
    "test/slow.test.ts": `import { expect, it } from "vitest";\nimport { double } from "../src/math";\n\nit("first", () => ${first});\nit("sleeps", () => new Promise((done) => setTimeout(done, 600_000)));\n`,
  });
  edit(root, {
    "src/math.ts": "export function double(x: number): number {\n  return x + x;\n}\n",
  });
  return root;
}

/*
 * Spec 020 D3.4 and D5 (amended 2026-11-10): a loading file that did not
 * finish rules out a pass, whether or not a test of it failed first.
 */
describe("squeal code --base: an unfinished loading file never passes (spec 020 D5)", () => {
  it.each([
    ["a test of it failed before the budget ended", "expect(double(2)).toBe(9)"],
    ["no test of it failed", "expect(double(2)).toBe(4)"],
  ])("exits 3 when %s", { timeout: 180_000 }, async (_, first) => {
    ownHomeAndTmp();
    const root = slowRepo(first);

    const ran = await code(root, ["--base", "main", "--json", "--timeout", BUDGET]);

    expect(ran.code).toBe(3);
    const report = JSON.parse(ran.stdout) as GateReport;
    // The case under test: one loader completed and one did not.
    expect(report.runs.map((r) => [r.completed, r.notFinished])).toEqual([
      [["test/math.test.ts"], ["test/slow.test.ts"]],
    ]);
    expect(report.functions.map((f) => [f.qualifiedName, f.state, f.gap])).toEqual([
      ["double", "incomplete", "not-finished"],
    ]);
    expect(report.verdict).toBe("incomplete");
  });
});

describe("squeal code --base: provenance (spec 020 D7, review 0.1.423 S1)", () => {
  it(
    "reports the counting keys read at the base, and the blob of a file over maxFileBytes",
    SLOW,
    async () => {
      ownHomeAndTmp();
      const policy = { complexity: { maxFileBytes: 300, exclude: ["src/generated/**"] } };
      const root = repo({ ...BASE, "squeal.config.json": JSON.stringify(policy) });
      edit(root, {
        "src/math.ts": "export function double(x: number): number {\n  return x + x;\n}\n",
        "src/big.ts": `export const big = 1;\n// ${"x".repeat(400)}\n`,
      });

      const ran = await code(root, ["--base", "main", "--json"]);

      expect(ran.code).toBe(3);
      const report = JSON.parse(ran.stdout) as GateReport;
      expect(report.base.policy).toMatchObject({
        complexityExclude: ["src/generated/**"],
        complexityMaxFileBytes: 300,
      });
      expect(report.base.policy.complexityInclude.length).toBeGreaterThan(0);
      expect(report.uncounted).toEqual([
        { path: "src/big.ts", reason: "too-large", gap: "not-counted" },
      ]);
      expect(report.head.paths).toEqual([
        { path: "src/big.ts", blob: gitHashObject(root, "src/big.ts") },
        { path: "src/math.ts", blob: gitHashObject(root, "src/math.ts") },
      ]);
    },
  );
});
