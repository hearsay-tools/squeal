import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runGateFiles } from "../../src/cli/code-gate-files.js";
import { FILE_ERROR } from "../../src/core/code/gate/evidence.js";
import type { AbsolutePath, RelativePath } from "../../src/core/types/common.js";
import { quiet } from "../code/gate/host-load.js";
import { BASE, edit, ownHomeAndTmp, repo, SLOW } from "./code-gate-fixture.js";

/*
 * Spec 023 D4.4, D5.2 (row 023-04): the gate as a library. It runs the
 * named test files only, even when the tree is dirty and a declared input
 * names the dirty path (`temp-checkout.md` 5.2), and answers per file with
 * the failed tests and their errors, no CC or CRAP verdict. `TMPDIR` is
 * the call's; `HOME` stays the process's.
 */

const ENV_TEST = [
  'import { expect, it } from "vitest";',
  "",
  "it(\"sees the call's TMPDIR and the process's HOME\", () => {",
  "  expect(process.env.TMPDIR).toBe(process.env.GATE_EXPECT_TMPDIR);",
  "  expect(process.env.HOME).toBe(process.env.GATE_EXPECT_HOME);",
  "});",
  "",
].join("\n");

const FILES: Readonly<Record<string, string>> = {
  ...BASE,
  "squeal.config.json": `${JSON.stringify({ inputs: { "test/other.test.ts": ["src/**"] } })}\n`,
  "test/env.test.ts": ENV_TEST,
  "test/fail.test.ts": `import { expect, it } from "vitest";\nimport { double } from "../src/math";\n\nit("triples", () => expect(double(2)).toBe(6));\n`,
  "test/broken.test.ts": `import { it } from "vitest";\nimport { gone } from "../src/gone";\n\nit("never runs", () => gone());\n`,
  "test/other.test.ts": `import { expect, it } from "vitest";\nimport { double } from "../src/math";\n\nit("doubles", () => expect(double(3)).toBe(6));\n`,
};

const saved = { a: process.env.GATE_EXPECT_TMPDIR, b: process.env.GATE_EXPECT_HOME };
afterEach(() => {
  for (const [key, value] of [
    ["GATE_EXPECT_TMPDIR", saved.a],
    ["GATE_EXPECT_HOME", saved.b],
  ] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("runGateFiles: the gate on named files, as a library (spec 023 D4.4, row 023-04)", () => {
  it(
    "runs only the named files and answers each with its failed tests and their errors",
    SLOW,
    async () => {
      ownHomeAndTmp();
      const root = repo(FILES) as AbsolutePath;
      // A dirty source the declared input of `other.test.ts` names: `squeal code --base` would select it.
      edit(root, {
        "src/math.ts": "export function double(x: number): number {\n  return x + x;\n}\n",
      });
      const temp = mkdtempSync(join(tmpdir(), "squeal-gate-files-")) as AbsolutePath;
      const home = process.env.HOME;
      process.env.GATE_EXPECT_TMPDIR = temp;
      process.env.GATE_EXPECT_HOME = home;
      const files = [
        "test/env.test.ts",
        "test/fail.test.ts",
        "test/broken.test.ts",
      ] as RelativePath[];

      const result = await runGateFiles({
        root,
        files,
        budgetSeconds: 100,
        tempDir: temp,
        hostLoad: quiet,
      });

      expect(result.timedOut).toBe(false);
      expect(result.runs.map((r) => [r.path, r.outcome, r.from])).toEqual([
        ["test/broken.test.ts", "failed", "run"],
        ["test/env.test.ts", "passed", "run"],
        ["test/fail.test.ts", "failed", "run"],
      ]);
      const fail = result.runs.find((r) => r.path === "test/fail.test.ts");
      expect(fail?.failed.map((f) => f.test)).toEqual(["triples"]);
      expect(fail?.failed[0]?.errors[0]?.message).toContain("expected 4 to be 6");
      const broken = result.runs.find((r) => r.path === "test/broken.test.ts");
      expect(broken?.failed.map((f) => f.test)).toEqual([FILE_ERROR]);
      expect(broken?.failed[0]?.errors[0]?.message).toMatch(/src\/gone/);
      expect(process.env.TMPDIR).not.toBe(temp);
      expect(process.env.HOME).toBe(home);
      // The gate's own folders went under the call's TMPDIR and were removed.
      expect(readdirSync(temp).filter((name) => name.startsWith("squeal-gate"))).toEqual([]);
    },
  );

  it(
    "reads a kept file from the stores on the next call, its failure text with it",
    SLOW,
    async () => {
      ownHomeAndTmp();
      const root = repo(FILES) as AbsolutePath;
      const files = ["test/fail.test.ts"] as RelativePath[];
      const first = await runGateFiles({ root, files, budgetSeconds: 100, hostLoad: quiet });
      expect(first.runs.map((r) => [r.path, r.outcome, r.from])).toEqual([
        ["test/fail.test.ts", "failed", "run"],
      ]);

      const second = await runGateFiles({ root, files, budgetSeconds: 100, hostLoad: quiet });

      expect(second.runs.map((r) => [r.path, r.outcome, r.from])).toEqual([
        ["test/fail.test.ts", "failed", "store"],
      ]);
      expect(second.runs[0]?.failed[0]?.errors[0]?.message).toContain("expected 4 to be 6");
      const off = await runGateFiles({
        root,
        files,
        budgetSeconds: 100,
        hostLoad: quiet,
        store: false,
      });
      expect(off.runs.map((r) => [r.path, r.outcome, r.from])).toEqual([
        ["test/fail.test.ts", "failed", "run"],
      ]);
    },
  );
});
