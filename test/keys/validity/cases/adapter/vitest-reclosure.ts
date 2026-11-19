import type { TestFileRef } from "../../../../../src/core/types/keys.js";
import type { Case } from "../../case.js";

/*
 * Row 011-414: the Vitest runner host keeps each path's answers and each
 * walked file's import entry, which it reuses while the file's bytes and
 * targets stay as they were. Here one adapter walks a file twice and a
 * module two test files share, then walks them again after the module's
 * bytes and targets change and after an added file resolves another
 * module's missing target at unchanged bytes. The import entries key
 * nothing; the closures, their keys and the runs equal the last release's.
 */

const ref = (path: string): TestFileRef => ({ project: "", path });

const test = (name: string, from: string, body: string) =>
  [
    'import { expect, it } from "vitest";',
    `import { value } from "${from}";`,
    `it("${name}", () => ${body});`,
    "",
  ].join("\n");

const FILES: Readonly<Record<string, string>> = {
  "package.json": '{ "name": "validity-vitest-reclosure", "private": true, "type": "module" }\n',
  "vitest.config.ts":
    'export default { test: { include: ["test/**/*.test.ts"], testTimeout: 60_000 } };\n',
  "src/dep.ts": "export const dep = 1;\n",
  "src/other.ts": "export const other = 2;\n",
  "src/lib.ts": 'import { dep } from "./dep.js";\nexport const value = dep;\n',
  "src/lazy.ts": 'export const value = 1;\nexport const later = () => import("./later.js");\n',
  "test/a.test.ts": test("a", "../src/lib.js", "expect(value).toBeGreaterThan(0)"),
  "test/b.test.ts": test("b", "../src/lib.js", "expect(value).toBeGreaterThan(0)"),
  "test/c.test.ts": test("c", "../src/lazy.js", "expect(value).toBe(1)"),
};

export const VITEST_RECLOSURE: readonly Case[] = [
  {
    kind: "adapter:vitest",
    name: "closures walked again after an edit and an add, on one adapter (row 011-414)",
    why: "011-414: a walked file's import entry is reused while its bytes and targets stay, and made again when either moves; the closures and their keys equal the last release's",
    input: {
      files: FILES,
      closures: [
        ref("test/a.test.ts"),
        ref("test/a.test.ts"),
        ref("test/b.test.ts"),
        ref("test/c.test.ts"),
      ],
      closuresAfter: {
        edits: [
          {
            path: "src/lib.ts",
            text: 'import { other } from "./other.js";\nexport const value = other;\n',
          },
          { path: "src/later.ts", text: "export const later = 3;\n" },
        ],
        closures: [ref("test/a.test.ts"), ref("test/b.test.ts"), ref("test/c.test.ts")],
      },
      runs: [],
    },
  },
];
