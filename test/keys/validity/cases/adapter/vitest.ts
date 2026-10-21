import type { TestFileRef } from "../../../../../src/core/types/index.js";
import type { Case, VitestInput } from "../../case.js";

/*
 * The Vitest adapter's runs (011 C14, task 011-37 section 2, row 011-41):
 * 013-01's adapter regressions 2 and 4 (013 `tasks/013-01/design.md`
 * section 6), a touch heard mid-run withholding only what the instance
 * could have read. Each held file waits while `$HOLD` exists; each carries
 * a skipped test, so the rows a run stores hold a skip.
 */

const vitest = (name: string, why: string, input: VitestInput): Case => ({
  kind: "adapter:vitest",
  name,
  why,
  input,
});

const held = (imports: string, body: string) =>
  [
    'import { existsSync, writeFileSync } from "node:fs";',
    'import { setTimeout as delay } from "node:timers/promises";',
    'import { expect, it } from "vitest";',
    imports,
    'it("holds", async () => {',
    '  writeFileSync($STARTED, "");',
    "  while (existsSync($HOLD)) await delay(20);",
    `  ${body}`,
    "}, 120_000);",
    'it.skip("waits", () => {});',
    "",
  ].join("\n");

const BASIC: Readonly<Record<string, string>> = {
  "package.json": '{ "name": "validity-vitest", "private": true, "type": "module" }\n',
  "vitest.config.ts":
    'export default { test: { include: ["test/**/*.test.ts"], setupFiles: ["test/setup.ts"], testTimeout: 60_000 } };\n',
  "test/setup.ts": "export {};\n",
  "dist/gen.js": "export const g = 1;\n",
  "dist/unrelated.js": "export const u = 1;\n",
  "src/dyn.ts": 'export const dyn = "dyn";\n',
  "test/slow1.test.ts": held('import { g } from "../dist/gen.js";', "expect(g).toBe(1);"),
  "test/slow2.test.ts": held("", "expect(1).toBe(1);"),
  "test/slow3.test.ts": held("", "expect(1).toBe(1);"),
  "test/computed.test.ts": [
    'import { expect, it } from "vitest";',
    'it("reads", async () => {',
    '  const { dyn } = await import(/* @vite-ignore */ ["..", "src", "dyn.ts"].join("/"));',
    '  expect(dyn).toBe("dyn");',
    "});",
    "",
  ].join("\n"),
};

/** A held file with no skip, so a change to how a skip is read leaves the failure case alone. */
const HELD_ONLY = [
  'import { existsSync, writeFileSync } from "node:fs";',
  'import { setTimeout as delay } from "node:timers/promises";',
  'import { expect, it } from "vitest";',
  'it("holds", async () => {',
  '  writeFileSync($STARTED, "");',
  "  while (existsSync($HOLD)) await delay(20);",
  "  expect(1).toBe(1);",
  "}, 120_000);",
  "",
].join("\n");

const FAILING: Readonly<Record<string, string>> = {
  ...BASIC,
  "test/held.test.ts": HELD_ONLY,
  "test/fails.test.ts": [
    'import { expect, it } from "vitest";',
    'it("fails", () => {',
    "  expect(1).toBe(2);",
    "});",
    "",
  ].join("\n"),
  "test/broken.test.ts": [
    'import { expect, it } from "vitest";',
    'import { missing } from "../src/missing.ts";',
    'it("never runs", () => expect(missing).toBe(1));',
    "",
  ].join("\n"),
};

const ref = (path: string, project = ""): TestFileRef => ({ project, path });
const SLOW = [1, 2, 3].map((n) => ref(`test/slow${n}.test.ts`));
const [, SLOW2, SLOW3] = SLOW;
const EVERY = [SLOW2, SLOW3, ref("test/computed.test.ts")].filter((r) => r !== undefined);

export const VITEST_RUNS: readonly Case[] = [
  vitest(
    "a touched module withholds the files that reach it (013-01 test 2)",
    "013-02 (013 V5 as amended 2026-10-20): a touch of dist/gen.js, which slow1 imports, withholds slow1 alone; dist/unrelated.js, which no module names, withholds nothing",
    { files: BASIC, runs: [{ files: SLOW, touched: ["dist/gen.js", "dist/unrelated.js"] }] },
  ),
  vitest(
    "a touched setup file, then a computed import() target, withholds every file of the run (013-01 test 4)",
    "013-02: a path the instance read that no test file's graph reaches withholds the whole run",
    {
      files: BASIC,
      runs: [
        { files: EVERY, touched: ["test/setup.ts"] },
        { files: EVERY, touched: ["src/dyn.ts"] },
      ],
    },
  ),
  vitest(
    "a module only another project loaded withholds none of this project's files (013-01 test 4)",
    "013-02: each project's server has a graph of its own; a touch withholds the files of the project that loaded the path",
    {
      files: {
        "package.json": BASIC["package.json"] ?? "",
        "vitest.config.ts":
          'export default { test: { projects: ["a/vitest.config.ts", "b/vitest.config.ts"] } };\n',
        "a/vitest.config.ts":
          'export default { test: { name: "a", include: ["test/*.test.ts"] } };\n',
        "b/vitest.config.ts":
          'export default { test: { name: "b", include: ["test/*.test.ts"] } };\n',
        "src/only-b.ts": "export const b = 1;\n",
        "a/test/held.test.ts": held("", "expect(1).toBe(1);"),
        "b/test/only.test.ts": [
          'import { expect, it } from "vitest";',
          'import { b } from "../../src/only-b.ts";',
          'it("reads", () => expect(b).toBe(1));',
          "",
        ].join("\n"),
      },
      runs: [
        {
          files: [ref("a/test/held.test.ts", "a"), ref("b/test/only.test.ts", "b")],
          touched: ["src/only-b.ts"],
        },
      ],
    },
  ),
  vitest(
    "a fileEnded callback that throws ends no run and loses no result (row 011-54)",
    "011-54: a throw inside Vitest's reporter hook would end the run crashed and store nothing; the adapter notes it and the run completes",
    { files: BASIC, runs: [{ files: SLOW, touched: [], fileEndedThrows: true }] },
  ),
  vitest(
    "a run cancelled with a cause completes none of its held files (row 011-56)",
    "011-56: a cancel's text names its cause, which is wording; what the cancelled run completes is stored",
    {
      files: BASIC,
      runs: [{ files: [SLOW2].filter((r) => r !== undefined), touched: [], cancel: "yield" }],
    },
  ),
  vitest(
    "a failing test and a file that fails to load store their fingerprints (review of cand/0.1.232, B1)",
    "a failure's fingerprint decides whether a later fail is the same failure (001 D6), so a change to how the adapter reads Vitest's errors changes what is stored",
    {
      files: FAILING,
      runs: [
        {
          files: [ref("test/held.test.ts"), ref("test/fails.test.ts"), ref("test/broken.test.ts")],
          touched: ["dist/unrelated.js"],
        },
      ],
    },
  ),
];
