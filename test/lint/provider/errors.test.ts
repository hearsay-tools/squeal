import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { eslintProvider } from "../../../src/core/lint/provider/eslint-provider.js";
import type { LintRunReport, LintSnapshot } from "../../../src/core/lint/provider/index.js";
import { project, provider, write } from "./helpers.js";

/* Spec 017 D9: each error case and what the provider tells of it. */

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function bare(): string {
  const dir = mkdtempSync(join(tmpdir(), "squeal-lint-bare-"));
  dirs.push(dir);
  return dir;
}

const OK = { path: "src/ok.js", text: "export const ok = 1;\n" };

describe("ESLint the provider does not run (spec 017 D9, non-goals)", () => {
  it("none installed: off, naming the root", async () => {
    const root = bare();
    expect(await provider(root).open()).toEqual({ off: `no ESLint installed in ${root}` });
  });

  it("ESLint 8: off", async () => {
    const root = bare();
    mkdirSync(join(root, "node_modules/eslint"), { recursive: true });
    writeFileSync(
      join(root, "node_modules/eslint/package.json"),
      '{ "name": "eslint", "version": "8.57.1" }',
    );
    expect(await provider(root).open()).toEqual({ off: "ESLint 8 is not supported" });
  });

  it("ESLint 9 told to read eslintrc: off", async () => {
    const eslint = provider(project("hazard", 9), { env: { ESLINT_USE_FLAT_CONFIG: "false" } });
    expect(await eslint.open()).toEqual({
      off: "eslintrc configs are not supported; ESLint 9 and 10 read eslint.config.*",
    });
  }, 30_000);

  it("no worker script beside the running code: off, since ESLint never runs in the daemon's thread", async () => {
    const eslint = eslintProvider({ root: bare(), script: null });
    expect(await eslint.open()).toEqual({ off: "the ESLint worker's script is not built" });
  });
});

describe("a keyed variable (spec 017 D5)", () => {
  it("is reported as the worker sees it", async () => {
    const eslint = provider(project("hazard", 9), { env: { ESLINT_USE_FLAT_CONFIG: "true" } });
    await eslint.open();
    const snapshot = (await eslint.refresh("none")) as LintSnapshot;
    expect(snapshot.env).toEqual({ ESLINT_USE_FLAT_CONFIG: "true", TSESTREE_SINGLE_RUN: "false" });
  }, 30_000);
});

describe("a config that does not load (spec 017 D9)", () => {
  for (const [what, config, message] of [
    [
      "a syntax error",
      "export default [;\n",
      /^eslint\.config\.js does not load: .*Unexpected token/,
    ],
    [
      "a missing plugin",
      'import missing from "eslint-plugin-missing";\nexport default [missing];\n',
      /^eslint\.config\.js does not load: Cannot find package 'eslint-plugin-missing'/,
    ],
  ] as const) {
    it(`${what}: inputs rejects and every file reads unknown with the reason, until the config is fixed`, async () => {
      const root = project("hazard");
      write(root, "eslint.config.js", config);
      const eslint = provider(root);
      expect(await eslint.open()).toHaveProperty("tool", "eslint");
      expect(await eslint.refresh("none")).toHaveProperty("closure");
      await expect(eslint.inputs([OK.path])).rejects.toThrow(message);
      const report = (await eslint.lint([OK])) as LintRunReport;
      expect(report.results.get(OK.path)).toEqual({ unknown: expect.stringMatching(message) });

      write(
        root,
        "eslint.config.js",
        'export default [{ rules: { "no-unused-vars": "error" } }];\n',
      );
      expect(await eslint.refresh("instance")).toHaveProperty("closure");
      expect([...(await eslint.inputs([OK.path])).keys()]).toEqual([OK.path]);
    }, 30_000);
  }
});

describe("a parse error in one file (spec 017 D9)", () => {
  it("is that file's finding, with no rule", async () => {
    const eslint = provider(project("hazard"));
    await eslint.open();
    const report = (await eslint.lint([
      { path: "src/broken.js", text: "let = ;\n" },
      OK,
    ])) as LintRunReport;
    expect(report.results.get("src/broken.js")).toEqual({
      findings: [
        expect.objectContaining({
          rule: null,
          message: "Parsing error: The keyword 'let' is reserved",
          severity: "error",
          line: 1,
        }),
      ],
    });
    expect(report.results.get(OK.path)).toEqual({ findings: [] });
  }, 30_000);
});
