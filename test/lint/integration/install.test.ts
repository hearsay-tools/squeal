import { describe, expect, it } from "vitest";
import { failedKey } from "../../../src/core/lint/pass/records.js";
import { FakeWorktree } from "../../code/pass/helpers.js";
import { commonDir, open } from "../helpers.js";
import { daemon } from "./helpers.js";
import { hoisted, pnpmExec, pnpmInstall } from "./pnpm.js";

/*
 * Row 017-20 (`lessons.md` L2): a config that requires a package not
 * installed reads unknown. After the package is installed, and the
 * install changes a tracked lockfile or manifest, the next pass gives the
 * CLI's results, with no daemon restart.
 */

const CONFIG = 'const hoisted = require("eslint-config-hoisted");\n\nmodule.exports = [hoisted];\n';
const HOISTED = 'module.exports = { rules: { "no-unused-vars": "error", "no-var": "error" } };\n';
const LOCK = "lockfileVersion: '9.0'\n";

describe("a config's missing package, then installed (row 017-20)", () => {
  it.each([
    ["the lockfile", "pnpm-lock.yaml", `${LOCK}\npackages:\n  eslint-config-hoisted@1.0.0: {}\n`],
    [
      "the manifest",
      "package.json",
      '{ "name": "install", "private": true, "devDependencies": {} }\n',
    ],
  ])(
    "changing %s: the next pass gives the CLI's results",
    async (_, path, text) => {
      const tree = new FakeWorktree("w1", commonDir());
      tree.write("package.json", '{ "name": "install", "private": true }\n');
      tree.write("pnpm-lock.yaml", LOCK);
      tree.write("eslint.config.js", CONFIG);
      tree.write("src/a.js", "var unused = 1;\n");
      pnpmInstall(tree.root);
      tree.revise();
      let install = 1;
      const one = daemon(tree, () => Promise.resolve(`install-${install}`));

      const before = await one.run("src/a.js");
      expect(before.state).toBeUndefined();
      expect(open(tree.commonDir).meta.get(failedKey(tree.id))).toMatch(
        /^eslint\.config\.js does not load: Cannot find module 'eslint-config-hoisted'/,
      );

      hoisted(tree.root, "eslint-config-hoisted", HOISTED);
      install = 2;
      tree.write(path, text);
      tree.revise();
      const after = await one.run("src/a.js");
      const expected = pnpmExec(tree.root, ["src/a.js"]).get("src/a.js");
      expect(expected).toMatchObject({ findings: { length: 2 } });
      if (expected === undefined || !("findings" in expected)) return;
      expect(open(tree.commonDir).meta.get(failedKey(tree.id))).toBeNull();
      expect(after.state).toMatchObject({ outcome: "fail" });
      expect(after.messages).toEqual(expected.findings.map((f) => f.message));
      await one.close();
    },
    120_000,
  );
});
