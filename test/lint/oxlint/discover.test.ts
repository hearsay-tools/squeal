import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { atLeast } from "../../../src/core/lint/provider/oxlint/discover.js";
import { TYPE_AWARE_OFF } from "../../../src/core/lint/provider/oxlint/index.js";
import type { AbsolutePath, RelativePath } from "../../../src/core/types/index.js";
import { project, provider, scratch, write } from "./helpers.js";

/*
 * Spec 017 D11 "Discovery" and "Type-aware rules": when oxlint is off, and
 * the line status gives. And a config above the root, which oxlint would
 * use while the root has none: its files read `unknown`.
 */

const A = "src/a.ts" as RelativePath;

describe("oxlint discovery", { timeout: 30_000 }, () => {
  it("is off with no oxlint installed", async () => {
    const root = scratch();
    write(root, { "src/a.ts": "export const a = 1;\n" });
    expect(await provider(root).open()).toEqual({ off: `no oxlint installed in ${root}` });
  });

  it("is off below 1.65, which has no `--debug files`", async () => {
    const root = scratch();
    write(root, {
      "node_modules/oxlint/package.json": JSON.stringify({ name: "oxlint", version: "1.64.0" }),
      "node_modules/oxlint/bin/oxlint": "throw new Error('never run');\n",
    });
    expect(await provider(root).open()).toEqual({ off: "oxlint 1.65 or later is needed" });
  });

  it("compares the major and minor version", () => {
    expect(atLeast("1.65.0", [1, 65])).toBe(true);
    expect(atLeast("1.90.0", [1, 65])).toBe(true);
    expect(atLeast("2.0.0", [1, 65])).toBe(true);
    expect(atLeast("1.64.9", [1, 65])).toBe(false);
    expect(atLeast("0.99.0", [1, 65])).toBe(false);
    expect(atLeast("next", [1, 65])).toBe(false);
  });

  it("declares the installed version and the configs, nested ones included", async () => {
    const root = project({
      ".oxlintrc.json": JSON.stringify({ extends: ["./configs/base.json"] }),
      "configs/base.json": JSON.stringify({ rules: { eqeqeq: "error" } }),
      "pkg/.oxlintrc.jsonc": '// nested\n{ "rules": { "no-debugger": "error", }, }\n',
      ".eslintignore": "gen/**\n",
      "src/a.ts": "export const a = 1;\n",
    });
    const version = JSON.parse(
      readFileSync(join(root, "node_modules/oxlint/package.json"), "utf8"),
    ).version;
    const lint = provider(root);
    expect(await lint.open()).toEqual({
      tool: "oxlint",
      toolVersion: version,
      providerVersion: 1,
      configFiles: [".eslintignore", ".oxlintrc.json", "pkg/.oxlintrc.jsonc"],
    });
    expect(await lint.refresh("none")).toMatchObject({
      closure: ["configs/base.json"],
      packages: ["oxlint"],
      program: [],
      env: {},
    });
  });
});

describe("a root config with type-aware rules", { timeout: 30_000 }, () => {
  it("turns oxlint off in JSON (D11)", async () => {
    const root = project({
      ".oxlintrc.json": JSON.stringify({ options: { typeAware: true } }),
      "src/a.ts": "export const a = 1;\n",
    });
    expect(await provider(root).open()).toEqual({ off: TYPE_AWARE_OFF });
    expect(TYPE_AWARE_OFF).toBe("oxlint with type-aware rules is not supported yet");
  });

  it("turns oxlint off in a TS config, which only oxlint can read", async () => {
    const root = project({
      "oxlint.config.ts": 'import { base } from "./shared.ts";\nexport default { ...base };\n',
      "shared.ts": "export const base = { options: { typeAware: true } };\n",
      "src/a.ts": "export const a = 1;\n",
    });
    expect(await provider(root).open()).toEqual({ off: TYPE_AWARE_OFF });
  });

  it("is on again once the config turns them off, at a refresh above none", async () => {
    const root = project({
      ".oxlintrc.json": JSON.stringify({ options: { typeAware: true } }),
      "src/a.ts": "export const a = 1;\n",
    });
    const lint = provider(root);
    expect(await lint.open()).toEqual({ off: TYPE_AWARE_OFF });
    write(root, { ".oxlintrc.json": JSON.stringify({ rules: { eqeqeq: "error" } }) });
    expect(await lint.refresh("none")).toEqual({ off: TYPE_AWARE_OFF });
    expect(await lint.refresh("instance")).toMatchObject({ declaration: { tool: "oxlint" } });
  });
});

describe("a config above the root", { timeout: 30_000 }, () => {
  it("makes every file `unknown` while the root has no config of its own", async () => {
    const parent = scratch();
    write(parent, { ".oxlintrc.json": JSON.stringify({ rules: { eqeqeq: "error" } }) });
    const root = join(parent, "project") as AbsolutePath;
    mkdirSync(root);
    project({ "src/a.ts": "export const f = (x: number) => x == 1;\n" }, root);
    const lint = provider(root);
    await lint.open();
    const text = readFileSync(join(root, A), "utf8");
    expect(await lint.lint([{ path: A, text }])).toMatchObject({
      results: new Map([[A, { unknown: "a config above the root applies: ../.oxlintrc.json" }]]),
    });

    write(root, { ".oxlintrc.json": "{}" });
    await lint.refresh("instance");
    expect(await lint.lint([{ path: A, text }])).toMatchObject({
      results: new Map([[A, { findings: [] }]]),
    });
  });
});
