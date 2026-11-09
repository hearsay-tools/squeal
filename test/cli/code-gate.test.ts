import { describe, expect, it } from "vitest";
import type { GateReport } from "../../src/core/code/gate/report.js";
import { BASE, code, edit, ownHomeAndTmp, repo, SLOW, TEST_FLAG } from "./code-gate-fixture.js";

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
    const ran = await code(root, ["--base", "main", TEST_FLAG, "test/nope.test.ts"]);
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
      "Usage: squeal code --base <ref> [<path>...] [--test <file>...] [--timeout <seconds>] [--json]",
    );
  });
});
