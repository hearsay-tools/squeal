import { realpathSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { LintRunReport, LintSnapshot } from "../../../src/core/lint/provider/index.js";
import { cli, onDisk, project, provider } from "./helpers.js";

const FILES = ["src/a.js", "src/b.js", "src/t.ts", "src/u.ts"];

describe("the ESLint provider (spec 017 D3, D5)", () => {
  for (const [major, version] of [
    [10, "10.13.0"],
    [9, "9.39.5"],
  ] as const) {
    it(`on ESLint ${major}, declares itself, reports what the config loaded and lints as the CLI`, async () => {
      const root = project("project", major);
      const real = realpathSync(root);
      const eslint = provider(root);

      expect(await eslint.open()).toEqual({
        tool: "eslint",
        toolVersion: version,
        providerVersion: 3,
        configFiles: ["eslint.config.js"],
      });

      const snapshot = (await eslint.refresh("none")) as LintSnapshot;
      expect(snapshot.closure).toEqual([
        "eslint.config.js",
        "eslint/local.js",
        "eslint/rules/no-foo.js",
        "tsconfig.json",
      ]);
      expect(snapshot.packages).toEqual(
        expect.arrayContaining([
          join(real, "node_modules/eslint-config-probe"),
          join(real, "node_modules/eslint-plugin-probe"),
        ]),
      );
      expect(snapshot.packages.some((p) => p.endsWith("/node_modules/typescript"))).toBe(true);
      expect(snapshot.program).toEqual(["src/t.ts", "src/u.ts"]);
      expect(snapshot.env).toEqual({ TSESTREE_SINGLE_RUN: "false" });

      const inputs = await eslint.inputs([
        ...FILES,
        "dist/out.js",
        "README.md",
        "eslint.config.js",
      ]);
      expect([...inputs.keys()]).toEqual(FILES);
      for (const file of FILES) expect(inputs.get(file)?.wholeProgram, file).toBe(true);
      const typed = inputs.get("src/t.ts")?.config ?? "";
      expect(typed).toContain('"tsconfigRootDir":"<root>"');
      expect(typed).not.toContain(real);

      const report = (await eslint.lint(onDisk(root, FILES))) as LintRunReport;
      expect(report.results).toEqual(cli(root, FILES));
      expect(report.program).toEqual(["src/t.ts", "src/u.ts"]);
    }, 60_000);
  }
});
