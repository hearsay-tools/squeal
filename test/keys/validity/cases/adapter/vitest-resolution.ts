import type { TestFileRef } from "../../../../../src/core/types/keys.js";
import type { Case } from "../../case.js";

/*
 * Row 023-14: the Vitest adapter's closure walk reads each module's import
 * specifiers and adds the manifests they read: a `#` import's nearest
 * `package.json` (an exact entry, one with conditions and a bare target in
 * an array, a pattern), the module's own package imported by name, an installed
 * package (none: the installed dependencies key it). The case reads the
 * closure and a run; the keys differ from the last release's (a re-key), and
 * the run stores alike.
 */

const ref = (path: string): TestFileRef => ({ project: "", path });

const TEST = "test/resolution.test.ts";

const FILES: Readonly<Record<string, string>> = {
  "package.json": `${JSON.stringify({
    name: "validity-resolution",
    private: true,
    type: "module",
    imports: {
      "#reg": "./src/reg-a.ts",
      // Reviews/wave-4.md B1: an entry's bare target, under conditions and in an array.
      "#own": { node: ["validity-resolution/reg"], default: "./src/reg-a.ts" },
      "#p/*": "./src/*.ts",
    },
    exports: { "./reg": "./src/reg-a.ts" },
  })}\n`,
  "vitest.config.ts":
    'export default { test: { include: ["test/**/*.test.ts"], testTimeout: 60_000 } };\n',
  "src/reg-a.ts": 'export const value = "a";\n',
  "src/self.ts": 'export { value as own } from "validity-resolution/reg";\n',
  "node_modules/dep/package.json": '{ "name": "dep", "type": "module", "main": "index.js" }\n',
  "node_modules/dep/index.js": "export const dep = 1;\n",
  "src/installed.ts": 'export { dep } from "dep";\n',
  // Its own package by name, no `exports`: the subpath's folder and the targets' folders key (B2).
  "inner/package.json": '{ "name": "inner", "type": "module" }\n',
  "inner/lib/v.ts": 'export const inner = "a";\n',
  "inner/m.ts":
    'export { inner } from "./lib/v.ts";\nexport const lazy = () => import("inner/sub");\n',
  [TEST]: [
    'import { existsSync, writeFileSync } from "node:fs";',
    'import { setTimeout as delay } from "node:timers/promises";',
    'import { expect, it } from "vitest";',
    'import { value } from "#reg";',
    'import { value as viaOwn } from "#own";',
    'import { value as viaPattern } from "#p/reg-a";',
    'import { own } from "../src/self.ts";',
    'import { dep } from "../src/installed.ts";',
    'import { inner } from "../inner/m.ts";',
    'it("holds", async () => {',
    '  writeFileSync($STARTED, "");',
    "  while (existsSync($HOLD)) await delay(20);",
    '  expect([value, own, dep, viaOwn, viaPattern, inner]).toEqual(["a", "a", 1, "a", "a", "a"]);',
    "}, 120_000);",
    "",
  ].join("\n"),
};

export const VITEST_RESOLUTION: readonly Case[] = [
  {
    kind: "adapter:vitest",
    name: "a closure whose imports read manifests: #, own package, installed (row 023-14)",
    why: "023-14: the walk adds the package.json files a module's # and bare imports read to its closure; keys differ (a re-key), the run stores alike",
    input: {
      files: FILES,
      closures: [ref(TEST)],
      runs: [{ files: [ref(TEST)], touched: [] }],
    },
  },
];
