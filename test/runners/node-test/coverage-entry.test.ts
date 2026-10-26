import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { NodeTestProject } from "../../../src/core/types/index.js";
import { coverageDir } from "../../../src/runners/node-test/run/coverage.js";
import { runNodeTest } from "../../../src/runners/node-test/run/run.js";

/*
 * Review 0.1.358 R2: the recorder deletes NODE_V8_COVERAGE at the test file
 * itself, not at the first parentless load. On Node 22.19 tsx's
 * `import "#cjs-loader"` is such a load, and tsx then starts its hooks thread,
 * which keeps the environment it started with. A `--require` by absolute path
 * is one on every Node, so this file shows the fault on each.
 */

const FIXTURES = resolve(import.meta.dirname, "../../fixtures/node-test");
const SLOW = { timeout: 60_000 } as const;
const scratch = join(FIXTURES, ".tmp", randomUUID());
const logs = mkdtempSync(join(tmpdir(), "squeal-node-test-coverage-entry-"));
afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
  rmSync(logs, { recursive: true, force: true });
});

const lines = (...text: string[]) => `${text.join("\n")}\n`;
const FILES: Readonly<Record<string, string>> = {
  "package.json": `${JSON.stringify({ name: "coverage-entry", type: "module" })}\n`,
  "scripts/absolute.cjs": lines("globalThis.absolute = 1;"),
  // As tsx's transform module reads the variable when it is evaluated.
  "scripts/late.mjs": lines("globalThis.late = process.env.NODE_V8_COVERAGE ?? 'unset';"),
  "test/a.test.mjs": lines(
    'import assert from "node:assert/strict";',
    'import { test } from "node:test";',
    "",
    'test("a preload after the absolute one saw the variable", () => {',
    "  assert.equal(globalThis.absolute, 1);",
    "  assert.notEqual(globalThis.late, 'unset');",
    "});",
    'test("sees no coverage variable", () => {',
    "  assert.equal(process.env.NODE_V8_COVERAGE, undefined);",
    "  assert.equal(process.env.SQUEAL_NODE_TEST_COVERAGE, undefined);",
    "});",
  ),
};

describe("the coverage variable goes at the test file (review 0.1.358 R2)", () => {
  it("keeps it for every preload, past a --require by absolute path", SLOW, async () => {
    for (const [path, text] of Object.entries(FILES)) {
      mkdirSync(dirname(join(scratch, path)), { recursive: true });
      writeFileSync(join(scratch, path), text);
    }
    const root = realpathSync(scratch);
    const project: NodeTestProject = {
      name: "p",
      node: process.execPath,
      argv: ["--require", join(root, "scripts/absolute.cjs"), "--import", "./scripts/late.mjs"],
      env: {},
      include: ["test/*.test.mjs"],
    };
    const logDir = join(logs, randomUUID());
    const { report } = await runNodeTest({
      root,
      project,
      files: [{ project: "p", path: "test/a.test.mjs" }],
      logDir,
      timeoutMs: 30_000,
      covered: () => true,
    });
    expect(report.results.map((r) => `${r.check.fullName}: ${r.outcome}`)).toEqual([
      "a preload after the absolute one saw the variable: pass",
      "sees no coverage variable: pass",
    ]);
    const names = readdirSync(coverageDir(logDir, 0));
    expect(names.filter((n) => /^coverage-\d+-\d+-0\.json$/.test(n))).toHaveLength(1);
    expect(names.filter((n) => n.startsWith("own-"))).toHaveLength(1);
  });
});
