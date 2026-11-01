import { describe, expect, it } from "vitest";
import { mayTurnOn, refreshLevel } from "../../../src/core/lint/pass/refresh.js";
import type { LintDeclaration, LintSnapshot } from "../../../src/core/lint/provider/index.js";
import { project, provider, write } from "./helpers.js";

/*
 * Row 017-20 (`lessons.md` L2): an install refreshes the worker at the
 * thread level, and while the config does not load the root's manifest
 * and lockfiles are in the closure, so a change to one does too.
 */

const DECLARATION: LintDeclaration = {
  tool: "eslint",
  toolVersion: "10.0.0",
  providerVersion: 5,
  configFiles: ["eslint.config.js"],
};

describe("an install's files and the refresh level (row 017-20)", () => {
  it("a tracked lockfile at any depth, or the installed one, is a new thread", () => {
    for (const path of [
      "pnpm-lock.yaml",
      "packages/app/package-lock.json",
      "yarn.lock",
      "bun.lock",
      "node_modules/.pnpm/lock.yaml",
    ]) {
      expect(refreshLevel([path], DECLARATION, []), path).toBe("thread");
      expect(mayTurnOn(path), path).toBe(true);
    }
  });

  it("a manifest is a new thread only while the closure holds it", () => {
    expect(refreshLevel(["package.json"], DECLARATION, [])).toBe("none");
    expect(refreshLevel(["package.json"], DECLARATION, ["package.json"])).toBe("thread");
    expect(mayTurnOn("package.json")).toBe(true);
  });
});

describe("a config that does not load (row 017-20)", () => {
  it("holds the root's manifest and lockfile in the closure until it loads in a new thread", async () => {
    const root = project("hazard");
    write(root, "pnpm-lock.yaml", "lockfileVersion: '9.0'\n");
    const config = 'import missing from "eslint-plugin-missing";\nexport default [missing];\n';
    write(root, "eslint.config.js", config);
    const eslint = provider(root);
    await eslint.open();
    const failed = (await eslint.refresh("none")) as LintSnapshot;
    expect(failed.closure).toEqual(expect.arrayContaining(["package.json", "pnpm-lock.yaml"]));
    expect(failed.held?.get("pnpm-lock.yaml")?.others).toHaveLength(1);

    write(root, "eslint.config.js", 'export default [{ rules: { "no-var": "error" } }];\n');
    const loaded = (await eslint.refresh("instance")) as LintSnapshot;
    expect(loaded.closure).toEqual(["eslint.config.js"]);
    expect(loaded.held?.has("pnpm-lock.yaml")).toBe(false);
  }, 30_000);
});
