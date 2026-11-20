import { describe, expect, it } from "vitest";
import { exportParts, project, record, reporterPair, withoutNodeOptions } from "./ci-record-kit.js";

/*
 * Review of 0.1.579 S1 (spec 018 D9, D24): a plain node:test project with
 * a `package.json`, an ESM test that imports a module and a CJS test that
 * requires one. The manifest is in each file's static closure, so its
 * evidence is taken where Node's module loader looks it up, during the
 * run: both files export. No preload reads it for them.
 */

const SLOW = { timeout: 120_000 } as const;
const FILES = {
  "package.json": `${JSON.stringify({ name: "plain", private: true })}\n`,
  "squeal.config.json": '{"nodeTest":[{"name":"unit","include":["test/*.test.*"]}]}\n',
  "lib/a.mjs": "export const a = 1;\n",
  "lib/b.cjs": "module.exports = { b: 2 };\n",
  "test/esm.test.mjs": [
    'import { test } from "node:test";',
    'import { a } from "../lib/a.mjs";',
    'test("a", () => { if (a !== 1) throw new Error("a"); });',
    "",
  ].join("\n"),
  "test/cjs.test.cjs": [
    'const { test } = require("node:test");',
    'const { b } = require("../lib/b.cjs");',
    'test("b", () => { if (b !== 2) throw new Error("b"); });',
    "",
  ].join("\n"),
};

describe("a plain ESM and CJS project with a package.json (review of 0.1.579 S1)", () => {
  it("exports both files, with the manifest's evidence from the run", SLOW, async () => {
    const root = project(FILES);
    const env = withoutNodeOptions();
    const command = [
      process.execPath,
      "--test",
      ...reporterPair(),
      "test/esm.test.mjs",
      "test/cjs.test.cjs",
    ];
    const recorded = await record(root, command, env);
    expect(recorded.code, recorded.stderr).toBe(0);
    expect(recorded.parts.flatMap((p) => Object.keys(p.evidence))).toContain("package.json");
    const exported = await exportParts(root, recorded.out, env);
    expect(exported.code, exported.stderr).toBe(0);
    expect(exported.stderr).not.toContain("package.json");
    expect(exported.stdout).toContain("Exported 2 test files, 4 results");
  });
});
