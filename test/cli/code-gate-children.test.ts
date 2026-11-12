import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GateReport } from "../../src/core/code/gate/report.js";
import { BASE, code, edit, noEstimate, ownHomeAndTmp, repo, SLOW } from "./code-gate-fixture.js";

/*
 * Spec 020 D12 items 6 and 7 (row 020-10b): `squeal code --base` with
 * `coverage.children` at the base measures what the processes the tests
 * start run. `scripts/tool.mjs` only runs in a child that
 * `test/tool.test.ts` starts, so `--test` selects it. `src/grade.mjs` is
 * imported by `test/grade.test.ts`, and only a child calls `grade`.
 */

// Under a daemon that measures this file's children, the fixture's workers would inherit the variable.
beforeEach(() => {
  vi.stubEnv("NODE_V8_COVERAGE", undefined);
});
afterEach(() => {
  vi.unstubAllEnvs();
});

const lines = (...text: string[]) => `${text.join("\n")}\n`;

const tool = (big: string) =>
  lines(
    "export function classify(n) {",
    `  if (n > ${big}) return "big";`,
    '  return "small";',
    "}",
    "process.stdout.write(classify(Number(process.argv[2])));",
  );

/** CC 6: at 0%, CRAP 6² + 6 = 42, over 30; at 100%, 6. */
const grade = (lowest: string) =>
  lines(
    "export function grade(score) {",
    '  if (score >= 90) return "A";',
    '  if (score >= 80) return "B";',
    '  if (score >= 70) return "C";',
    '  if (score >= 60) return "D";',
    `  if (score >= ${lowest}) return "E";`,
    '  return "?";',
    "}",
    'export const SCALE = "A-E";',
  );

const FILES = {
  ...BASE,
  "scripts/tool.mjs": tool("10"),
  "src/grade.mjs": grade("0"),
  "scripts/grade-cli.mjs": lines(
    'import { grade } from "../src/grade.mjs";',
    'process.stdout.write(process.argv.slice(2).map((s) => grade(Number(s))).join(""));',
  ),
  "test/tool.test.ts": lines(
    'import { execFileSync } from "node:child_process";',
    'import { fileURLToPath } from "node:url";',
    'import { expect, it } from "vitest";',
    'const tool = fileURLToPath(new URL("../scripts/tool.mjs", import.meta.url));',
    'const run = (n: number) => execFileSync(process.execPath, [tool, String(n)], { encoding: "utf8" });',
    'it("classifies", () => {',
    '  expect(run(1)).toBe("small");',
    '  expect(run(20)).toBe("big");',
    "});",
  ),
  "test/grade.test.ts": lines(
    'import { execFileSync } from "node:child_process";',
    'import { fileURLToPath } from "node:url";',
    'import { expect, it } from "vitest";',
    'import { SCALE } from "../src/grade.mjs";',
    'const cli = fileURLToPath(new URL("../scripts/grade-cli.mjs", import.meta.url));',
    'it("grades every band", () => {',
    '  expect(SCALE).toBe("A-E");',
    '  const out = execFileSync(process.execPath, [cli, "95", "85", "75", "65", "5", "-1"], { encoding: "utf8" });',
    '  expect(out).toBe("ABCDE?");',
    "});",
  ),
};

const BOTH = { "scripts/tool.mjs": tool("9"), "src/grade.mjs": grade("1") };

/** By default the branch edits both functions; the tests and the config stay as at the base. */
async function gate(
  config: Record<string, unknown> | null,
  edits: Readonly<Record<string, string>> = BOTH,
  tests: readonly string[] = ["--test", "test/tool.test.ts"],
) {
  const leftInTmp = ownHomeAndTmp();
  const root = repo(
    config === null ? FILES : { ...FILES, "squeal.config.json": JSON.stringify(config) },
  );
  edit(root, edits);
  const ran = await code(root, ["--base", "main", "--json", ...tests]);
  const report = JSON.parse(ran.stdout) as GateReport;
  const states = report.functions.map((f) => `${f.qualifiedName} ${f.state} ${f.gap ?? f.crap}`);
  return { ran, report, states, leftInTmp };
}

/** D14.4 (row 020-34): the line when some selected file runs, so a process it starts may run the script. */
const CHILD_MAY_LOAD =
  "squeal code: no selected test file imports scripts/tool.mjs. With coverage.children, it is measured only if a process one of them starts loads it; else its 1 changed function will read incomplete (no-loader). To select a test that starts it, give the test with --test or declare the path for it in inputs at the base; to skip its coverage, name it in coverage.exclude at the base.";

/** D14.4: the line when no selected file runs, with coverage.children too (row 020-34). */
const UNLOADED =
  "squeal code: no test Squeal runs loads scripts/tool.mjs: no Vitest or node:test project lists it, and no listed test file imports it. Its 1 changed function will read incomplete (no-loader). To measure it, give it to a runner (a nodeTest entry, with prepare when it needs a build); to skip its coverage, name it in coverage.exclude at the base.";

describe("squeal code --base with coverage.children (spec 020 D12)", () => {
  it("passes a script only a child runs, and a function only a child calls", SLOW, async () => {
    const { ran, report, states, leftInTmp } = await gate({ coverage: { children: true } });

    // D14.4 (row 020-34): no selected file imports the script, but a process one starts may run it.
    expect(ran.stderr).toBe(
      `squeal code: Vitest: 2 test files to run (tests 2)\n${CHILD_MAY_LOAD}\n${noEstimate("Vitest", 2)}`,
    );
    expect(states).toEqual(["classify pass 2", "grade pass 6"]);
    expect(ran.code).toBe(0);
    expect(report.base.policy.coverageChildren).toBe(true);
    const measured = report.functions.map((f) => [f.path, f.loaders.measured]);
    expect(measured).toEqual([
      ["scripts/tool.mjs", ["test/tool.test.ts"]],
      ["src/grade.mjs", ["test/grade.test.ts"]],
    ]);
    // One file per child process: two runs of the tool, one of the grade CLI.
    expect(report.runs.map((r) => [r.runner, r.completed, r.children])).toEqual([
      ["vitest", ["test/grade.test.ts", "test/tool.test.ts"], { read: 3, dropped: 0 }],
    ]);
    expect(leftInTmp()).toEqual([]);
  });

  it(
    "names a child-only script as unloaded when no selected test file runs (row 020-34)",
    SLOW,
    async () => {
      const { ran, states, leftInTmp } = await gate(
        { coverage: { children: true } },
        { "scripts/tool.mjs": tool("9") },
        [],
      );

      expect(ran.stderr).toBe(`squeal code: Vitest: no test file to run\n${UNLOADED}\n`);
      expect(states).toEqual(["classify incomplete no-loader"]);
      expect(ran.code).toBe(3);
      expect(leftInTmp()).toEqual([]);
    },
  );

  it(
    "without it, reads the child's script incomplete and the uncalled function a violation",
    SLOW,
    async () => {
      const { ran, report, states } = await gate(null);

      expect(states).toEqual(["classify incomplete no-loader", "grade violation 42"]);
      expect(ran.code).toBe(1);
      expect(report.base.policy).not.toHaveProperty("coverageChildren");
      expect(report.runs[0]).not.toHaveProperty("children");
    },
  );

  it(
    "reads the key at the base: a branch that turns it on is judged without it",
    SLOW,
    async () => {
      const leftInTmp = ownHomeAndTmp();
      const root = repo(FILES);
      edit(root, {
        "scripts/tool.mjs": tool("9"),
        "src/grade.mjs": grade("1"),
        "squeal.config.json": JSON.stringify({ coverage: { children: true } }),
      });

      const ran = await code(root, ["--base", "main", "--json", "--test", "test/tool.test.ts"]);

      const report = JSON.parse(ran.stdout) as GateReport;
      expect(report.functions.map((f) => `${f.qualifiedName} ${f.state}`)).toEqual([
        "classify incomplete",
        "grade violation",
      ]);
      expect(ran.code).toBe(1);
      expect(leftInTmp()).toEqual([]);
    },
  );
});
