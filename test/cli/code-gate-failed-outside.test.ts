import { describe, expect, it } from "vitest";
import type { GateFunctionReport, GateReport } from "../../src/core/code/gate/report.js";
import { code, edit, ownHomeAndTmp, repo } from "./code-gate-fixture.js";

/*
 * Row 020-53 (#210, `research/issue-210.md`): the probe's shape. A changed
 * node:test callback that passes with full coverage, beside an unrelated
 * base test file that fails and that `--test` selects. The callback still
 * reads `test-failed` (D5.5), now with the failure named as outside its
 * loaders, first from this command's run, then from the stores. The verdict,
 * exit code and policy version are as before.
 */

const SLOW = { timeout: 240_000 } as const;

const A = "test/a.test.mjs";
const B = "test/b.test.mjs";

const callback = (value: string) =>
  `import test from "node:test";\nimport assert from "node:assert/strict";\n\ntest("changed passing callback", () => {\n  const value = ${value};\n  assert.equal(value, 2);\n});\n`;

const BASE: Readonly<Record<string, string>> = {
  "package.json": `${JSON.stringify({ name: "gate-failed-outside", private: true, type: "module" })}\n`,
  "squeal.config.json": `${JSON.stringify({
    runner: { tierSize: 1 },
    nodeTest: [{ name: "probe", include: ["test/*.test.mjs"] }],
  })}\n`,
  [A]: callback("2"),
  [B]: `import test from "node:test";\nimport assert from "node:assert/strict";\n\ntest("unrelated base test", () => {\n  assert.equal(1, 2);\n});\n`,
};

const ARGS = ["--base", "main", "--test", B, "--timeout", "120"];

async function gate(root: string) {
  const ran = await code(root, [...ARGS, "--json"]);
  const report = JSON.parse(ran.stdout) as GateReport;
  const [changed] = report.functions as [GateFunctionReport];
  return { code: ran.code, report, changed };
}

describe("squeal code --base names a failure outside a function's loaders (row 020-53, #210)", () => {
  it(
    "names it in JSON from the run and then the stores, and in text, verdict and exit as before",
    SLOW,
    async () => {
      ownHomeAndTmp();
      const root = repo(BASE);
      edit(root, { [A]: callback("1 + 1") });

      const first = await gate(root);
      expect(first.code).toBe(3);
      expect(first.report.verdict).toBe("incomplete");
      expect(first.report.versions.qualityPolicy).toBe(4);
      expect(first.changed).toMatchObject({
        path: A,
        state: "incomplete",
        gap: "test-failed",
        coverage: { share: 1 },
        loaders: { expected: [A], measured: [A] },
        failedTests: [{ path: B, tests: ["unrelated base test"], from: "run", loader: false }],
      });

      const repeat = await gate(root);
      expect(repeat.code).toBe(3);
      expect(repeat.report.runs[0]?.from).toEqual({ [A]: "store", [B]: "store" });
      expect(repeat.changed.failedTests).toEqual([
        { path: B, tests: ["unrelated base test"], from: "store", loader: false },
      ]);

      const text = await code(root, ARGS);
      expect(text.code).toBe(3);
      expect(text.stdout).toContain(
        ": incomplete: a selected test failed outside its loaders: test/b.test.mjs › unrelated base test\n",
      );
    },
  );
});
