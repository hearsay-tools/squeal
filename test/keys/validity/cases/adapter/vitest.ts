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

/**
 * Row 011-95: Vitest includes `e2e/`, which the case's `vitest.exclude` leaves
 * out. The run's files hold no skip, so a change to how a skip is read leaves
 * the case alone.
 */
const INCLUDES_E2E: Readonly<Record<string, string>> = {
  ...BASIC,
  "test/held.test.ts": HELD_ONLY,
  "vitest.config.ts":
    'export default { test: { include: ["test/**/*.test.ts", "e2e/**/*.test.ts"], setupFiles: ["test/setup.ts"], testTimeout: 60_000 } };\n',
};

/**
 * Row 011-144: four checks, one red and held, one in a nested suite, one at
 * top level; the texts `new` select three. A tree that does not focus runs
 * the whole file, and the harness compares the selected checks alone.
 */
const FOCUSED: Readonly<Record<string, string>> = {
  ...FAILING,
  "test/four.test.ts": [
    'import { existsSync, writeFileSync } from "node:fs";',
    'import { setTimeout as delay } from "node:timers/promises";',
    'import { describe, expect, it } from "vitest";',
    'describe("parity", () => {',
    '  it("old 1", () => expect(1).toBe(1));',
    '  it("new 1 holds", async () => {',
    '    writeFileSync($STARTED, "");',
    "    while (existsSync($HOLD)) await delay(20);",
    "    expect(1).toBe(2);",
    "  }, 120_000);",
    '  describe("inner", () => {',
    '    it("new 2", () => expect(1).toBe(1));',
    "  });",
    "});",
    'it("new 3 top", () => expect(1).toBe(1));',
    "",
  ].join("\n"),
};

/**
 * Row 011-137: its test passes and its skip is declared; its `afterAll` holds
 * the module open while `$HOLD` exists, which the harness removes once the
 * run is cancelled, so the module ends whole in the cancel's grace.
 */
const WHOLE_IN_GRACE: Readonly<Record<string, string>> = {
  ...BASIC,
  "test/whole.test.ts": [
    'import { existsSync, writeFileSync } from "node:fs";',
    'import { setTimeout as delay } from "node:timers/promises";',
    'import { afterAll, expect, it } from "vitest";',
    'it("passes", () => expect(1).toBe(1));',
    'it.skip("waits", () => {});',
    "afterAll(async () => {",
    '  writeFileSync($STARTED, "");',
    "  while (existsSync($HOLD)) await delay(20);",
    "});",
    "",
  ].join("\n"),
};

/** Revision `n` of an excluded test file. */
const e2eTest = (n: number) =>
  `import { expect, it } from "vitest";\nit("e2e ${n}", () => expect(${n}).toBe(${n}));\n`;

const ref = (path: string, project = ""): TestFileRef => ({ project, path });
const SLOW = [1, 2, 3].map((n) => ref(`test/slow${n}.test.ts`));
const [, SLOW2, SLOW3] = SLOW;
const EVERY = [SLOW2, SLOW3, ref("test/computed.test.ts")].filter((r) => r !== undefined);

/** A global setup that says it started, then throws (task 001-382). */
const REJECTING: Readonly<Record<string, string>> = {
  "package.json": BASIC["package.json"] ?? "",
  "vitest.config.ts":
    'export default { test: { include: ["test/*.test.ts"], globalSetup: ["./boot.ts"] } };\n',
  "boot.ts": [
    'import { writeFileSync } from "node:fs";',
    "export default function setup() {",
    '  writeFileSync($STARTED, "");',
    '  throw new Error("bootstrap");',
    "}",
    "",
  ].join("\n"),
  "test/one.test.ts":
    'import { expect, it } from "vitest";\nit("never runs", () => expect(1).toBe(1));\n',
};

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
    // A held file with no skip, so a change to how a skip is read leaves this case alone.
    {
      files: FAILING,
      runs: [{ files: [ref("test/held.test.ts")], touched: [], fileEndedThrows: true }],
    },
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
    "a step-down's cancel completes a module that ended whole in its grace (row 011-137)",
    "011 C9 as proposed in tasks/011-137/notes.md: under a step-down, a module that ended after the cancel, passed, with no test the cancel skipped, stores its results; the last release stores nothing of it, so the candidate stores more",
    {
      files: WHOLE_IN_GRACE,
      runs: [{ files: [ref("test/whole.test.ts")], touched: [], cancel: "step-down" }],
    },
  ),
  vitest(
    "a run whose signal was aborted before it started completes nothing (review 0.1.239 B2)",
    "011-56: an early cancel's note names its cause, which is wording; that the run completes and stores nothing is stored",
    {
      files: BASIC,
      runs: [{ files: [SLOW2].filter((r) => r !== undefined), touched: [], cancelBefore: "stop" }],
    },
  ),
  vitest(
    "a run whose global setup throws stores nothing, and its instance is closed (row 013-06)",
    "001-382: a rejected run's instance is closed, so the next run calls the setup again; 013-06 empties it once closed",
    { files: REJECTING, runs: [{ files: [ref("test/one.test.ts")], touched: [] }] },
  ),
  vitest(
    "a run whose instance lost its temp directory stores nothing, and its instance is closed (row 013-06)",
    "001 D5 (lessons, defect 12): a runner failure is a crash, never a fail stored under a key; 013-06 empties the broken instance once closed",
    // A held file with no skip, so a change to how a skip is read leaves this case alone.
    {
      files: FAILING,
      runs: [
        { files: [ref("test/held.test.ts")], touched: [] },
        { files: [ref("test/held.test.ts")], touched: [], removeTempDir: true },
      ],
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
  vitest(
    "a focused run stores the selected checks' outcomes as a whole run does (row 011-144)",
    "011 C14 as amended 2026-10-23: a run given texts runs only the checks whose name holds one, so its selected checks, a file that fails to load and a file without texts beside them read as in a whole run; the focused tier stores nothing (C4), and this pins that the filter changes no outcome it selects",
    {
      files: FOCUSED,
      runs: [
        {
          files: [ref("test/four.test.ts"), ref("test/broken.test.ts"), ref("test/fails.test.ts")],
          touched: [],
          checks: [
            { testFile: ref("test/four.test.ts"), texts: ["new", "parity > inner"] },
            { testFile: ref("test/broken.test.ts"), texts: ["never"] },
          ],
        },
      ],
    },
  ),
  vitest(
    "an excluded test file added and changed twice during a run withholds nothing (row 011-95)",
    "011-95 (013 V7 as amended 2026-10-21): the related walk loads only the test files Squeal lists, so a file vitest.exclude leaves out that Vitest's include matches is never loaded, and its writes during a run no longer withhold every file of it",
    {
      files: INCLUDES_E2E,
      exclude: ["e2e/**"],
      runs: [
        {
          files: [ref("test/held.test.ts"), ref("test/computed.test.ts")],
          touched: [],
          edits: [1, 2, 3].map((n) => ({ path: "e2e/x.test.ts", text: e2eTest(n) })),
        },
      ],
    },
  ),
];
