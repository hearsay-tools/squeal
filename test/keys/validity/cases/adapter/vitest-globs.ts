import type { TestFileRef } from "../../../../../src/core/types/keys.js";
import type { Case } from "../../case.js";

/*
 * Row 023-13 (fix A): the Vitest adapter's closure walk reads each module
 * that may glob from its syntax tree and reports the folders its globs list
 * (`RunnerClosure.globs`), one module per way Vite resolves a pattern: an
 * array with a negation, a `base`, the root, `../` with no pattern, an
 * alias, a template-literal `import()`, glob text in a comment only, and a
 * module strip mode refuses. No key the case reads holds the report, so the
 * keys equal the last release's; the run stores alike.
 */

const ref = (path: string): TestFileRef => ({ project: "", path });

export const GLOB_TEST = "test/globs.test.ts";

/** The fixture, which the adapter test `closure-globs.test.ts` walks too. */
export const GLOB_FILES: Readonly<Record<string, string>> = {
  "package.json": '{ "name": "validity-vitest-globs", "private": true, "type": "module" }\n',
  "vitest.config.ts": [
    'import { fileURLToPath } from "node:url";',
    "export default {",
    '  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },',
    '  test: { include: ["test/**/*.test.ts"], testTimeout: 60_000 },',
    "};",
    "",
  ].join("\n"),
  "src/plugins/kept.ts": 'export const name = "kept";\n',
  "src/plugins/skip.ts": 'export const name = "skip";\n',
  "src/registry.ts":
    'export const all = import.meta.glob(["./plugins/*.ts", "!./plugins/skip.ts"], { eager: true });\n',
  "src/based.ts": 'export const based = import.meta.glob("./*.ts", { base: "./plugins" });\n',
  "src/rooted.ts": "export const rooted = import.meta.glob(`/src/plugins/*.ts`);\n",
  "src/sub/up.ts": 'export const up = import.meta.glob("../plugins/kept.ts");\n',
  "src/aliased.ts": 'export const aliased = import.meta.glob("@/plugins/*.ts");\n',
  // biome-ignore lint/suspicious/noTemplateCurlyInString: the module's own template literal.
  "src/locale.ts": "export const load = (n: string) => import(`./plugins/${n}.ts`);\n",
  "src/decoy.ts": '// import.meta.glob("./plugins/*.ts") in a comment\nexport const decoy = 1;\n',
  "src/enumed.ts":
    'export enum Kind { A }\nexport const kinds = import.meta.glob("./plugins/*.ts");\n',
  [GLOB_TEST]: [
    'import { existsSync, writeFileSync } from "node:fs";',
    'import { setTimeout as delay } from "node:timers/promises";',
    'import { expect, it } from "vitest";',
    'import { aliased } from "../src/aliased.ts";',
    'import { based } from "../src/based.ts";',
    'import { decoy } from "../src/decoy.ts";',
    'import { kinds } from "../src/enumed.ts";',
    'import { load } from "../src/locale.ts";',
    'import { all } from "../src/registry.ts";',
    'import { rooted } from "../src/rooted.ts";',
    'import { up } from "../src/sub/up.ts";',
    'it("holds", async () => {',
    '  writeFileSync($STARTED, "");',
    "  while (existsSync($HOLD)) await delay(20);",
    "  expect(Object.keys(all)).toHaveLength(1);",
    "  expect(Object.keys(based)).toHaveLength(2);",
    "  expect(Object.keys({ ...aliased, ...rooted, ...up, ...kinds })).not.toHaveLength(0);",
    '  expect((await load("kept")).name).toBe("kept");',
    "  expect(decoy).toBe(1);",
    "}, 120_000);",
    "",
  ].join("\n"),
};

export const VITEST_GLOBS: readonly Case[] = [
  {
    kind: "adapter:vitest",
    name: "a closure whose modules glob folders every way Vite resolves one (row 023-13)",
    why: "023-13 (fix A): the walk reports each module's glob folders beside the closure, which no key the case reads holds; the closure, its keys and the run equal the last release's",
    input: {
      files: GLOB_FILES,
      closures: [ref(GLOB_TEST)],
      runs: [{ files: [ref(GLOB_TEST)], touched: [] }],
    },
  },
];
