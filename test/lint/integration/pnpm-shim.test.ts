import { describe, expect, it } from "vitest";
import { FakeWorktree } from "../../code/pass/helpers.js";
import { commonDir } from "../helpers.js";
import { cli } from "../provider/helpers.js";
import { daemon } from "./helpers.js";
import { hoisted, pnpmExec, pnpmInstall } from "./pnpm.js";

/*
 * Row 017-19 (`lessons.md` L1): a config that loads only through pnpm's bin
 * shim. It requires a package it does not declare, which pnpm puts only in
 * `node_modules/.pnpm/node_modules`; the shim adds that folder to
 * `NODE_PATH`. Squeal's results equal `pnpm exec eslint`'s.
 */

const CONFIG = 'const hoisted = require("eslint-config-hoisted");\n\nmodule.exports = [hoisted];\n';
const HOISTED = 'module.exports = { rules: { "no-unused-vars": "error", "no-var": "error" } };\n';

describe("a config that loads only through pnpm's bin shim (row 017-19)", () => {
  it("gives the results of pnpm exec eslint", async () => {
    const tree = new FakeWorktree("w1", commonDir());
    tree.write("package.json", '{ "name": "shim", "private": true }\n');
    tree.write("eslint.config.js", CONFIG);
    tree.write("src/a.js", "var unused = 1;\n");
    tree.write("src/b.js", "export const b = 1;\n");
    pnpmInstall(tree.root);
    hoisted(tree.root, "eslint-config-hoisted", HOISTED);
    tree.revise();

    // Plain node, as the worker started ESLint before, does not load the config.
    expect(() => cli(tree.root, ["src/a.js"])).toThrow(
      /Cannot find module 'eslint-config-hoisted'/,
    );
    const expected = pnpmExec(tree.root, ["src/a.js", "src/b.js"]);
    expect(expected.get("src/a.js")).toMatchObject({ findings: { length: 2 } });

    const one = daemon(tree);
    for (const path of ["src/a.js", "src/b.js"]) {
      const result = await one.run(path);
      const findings = expected.get(path);
      expect(findings).toBeDefined();
      if (findings === undefined || !("findings" in findings)) continue;
      expect(result.state).toMatchObject({
        outcome: findings.findings.length > 0 ? "fail" : "pass",
      });
      expect(result.messages).toEqual(findings.findings.map((f) => f.message));
      expect(result.rules).toEqual(findings.findings.map((f) => f.rule));
    }
    await one.close();
  }, 120_000);
});
