import type { Case } from "../../case.js";

/*
 * The node:test adapter's decisions (011 C14, spec 003 D1 to D6, row
 * 016-17), on the driver's own Node: what a run stores (outcomes, a file
 * that fails to load), and from row 016-17 the directories a test creates,
 * which the module recorder records for the core's written-directory bound
 * (016 D4).
 */

const lines = (...text: string[]) => `${text.join("\n")}\n`;

const PACKAGE = `${JSON.stringify({ name: "validity", type: "module" })}\n`;

const OUTCOMES: Readonly<Record<string, string>> = {
  "package.json": PACKAGE,
  "test/pass.test.mjs": lines('import { test } from "node:test";', "", 'test("passes", () => {});'),
  "test/fail.test.mjs": lines(
    'import assert from "node:assert/strict";',
    'import { test } from "node:test";',
    "",
    'test("passes", () => {});',
    'test("fails", () => {',
    "  assert.equal(1, 2);",
    "});",
  ),
  "test/broken.test.mjs": lines('import "./validity-missing-module.mjs";'),
};

/** Row 016-17: a test that reads its own directory create from the record only 016 D4's recorder writes. */
const SEES_WRITTEN: Readonly<Record<string, string>> = {
  "package.json": PACKAGE,
  "test/sees-written.test.mjs": lines(
    'import assert from "node:assert/strict";',
    'import { mkdirSync, readFileSync } from "node:fs";',
    'import { test } from "node:test";',
    'import { fileURLToPath } from "node:url";',
    "",
    'test("sees the directory it made recorded as written", () => {',
    '  const made = fileURLToPath(new URL("./made", import.meta.url));',
    "  mkdirSync(made);",
    '  const graph = process.env.SQUEAL_NODE_TEST_GRAPH + "-" + process.pid + ".ndjson";',
    '  const written = readFileSync(graph, "utf8")',
    '    .split("\\n")',
    "    .filter((line) => line.includes('\"written\"'))",
    "    .map((line) => JSON.parse(line).written);",
    "  assert.ok(written.includes(made), JSON.stringify(written));",
    "});",
  ),
};

export const NODE_TEST_RUNS: readonly Case[] = [
  {
    kind: "adapter:node-test",
    name: "outcomes of a passing file, a failing one and one that fails to load",
    why: "003 D2 and D4: each test's outcome and fingerprint, and a file whose import fails, decide the rows a run stores",
    input: {
      files: OUTCOMES,
      runs: [{ files: ["test/broken.test.mjs", "test/fail.test.mjs", "test/pass.test.mjs"] }],
    },
  },
  {
    kind: "adapter:node-test",
    name: "a test sees the directory it made recorded as written",
    why: "016 D4, the case that stands for NODE_TEST_ADAPTER_VERSION 10. Observable: the module recorder records each directory a test creates or removes in the run's graph, so under one key a test that reads it stores a pass where the last release stored a fail. The reason for the raise: the core now keeps what runs loaded, a git-ignored load unless the run created or removed one of its directories, and loads key whatever observe.runtimeInputs says; this kind reads closures as keys, so the change of what is kept shows here through the recorder (the human, 2026-10-25)",
    input: { files: SEES_WRITTEN, runs: [{ files: ["test/sees-written.test.mjs"] }] },
  },
];
