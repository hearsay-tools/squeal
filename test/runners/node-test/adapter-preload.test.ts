import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { NodeTestProject } from "../../../src/core/types/index.js";
import { createNodeTestAdapter } from "../../../src/runners/node-test/adapter.js";

/**
 * Review wave 2, B1: a file a preload loads through a computed `import()`
 * is in no static closure. Each run names it in `environmentObserved`
 * (task 003-43); since spec 016 D4 the core keeps it as a start-up path,
 * keys the project's environment with it and reads it in every worktree
 * (`test/scheduler/one-write-path.test.ts`). Spec 003 D1 (the preloads'
 * closure is an environment input), D3, D5.
 */

const FIXTURES = resolve(import.meta.dirname, "../../fixtures/node-test");
const SLOW = { timeout: 60_000 } as const;
const scratch = join(FIXTURES, ".tmp", randomUUID());
const logs = mkdtempSync(join(tmpdir(), "squeal-node-test-preload-"));
let root = "";

const FILES: Readonly<Record<string, string>> = {
  "package.json": `${JSON.stringify({ name: "preload", private: true, type: "module" })}\n`,
  "scripts/setup.mjs": `await import("./helper" + ".mjs");\n`,
  "scripts/helper.mjs": "globalThis.helperValue = 1;\n",
  "test/a.test.ts": [
    `import assert from "node:assert/strict";`,
    `import { test } from "node:test";`,
    `test("the preload's helper ran", () => assert.equal((globalThis as { helperValue?: number }).helperValue, 1));`,
    "",
  ].join("\n"),
};

beforeAll(() => {
  for (const [path, text] of Object.entries(FILES)) {
    mkdirSync(dirname(join(scratch, "repo", path)), { recursive: true });
    writeFileSync(join(scratch, "repo", path), text);
  }
  root = realpathSync(join(scratch, "repo"));
});
afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
  rmSync(logs, { recursive: true, force: true });
});

const PROJECT: NodeTestProject = {
  name: "p",
  node: process.execPath,
  argv: ["--import", "./scripts/setup.mjs", "--import", "tsx"],
  env: {},
  include: ["test/*.test.ts"],
};
const A = { project: "p", path: "test/a.test.ts" };
const HELPER = "scripts/helper.mjs";

describe("a path a preload loads at run time (review wave 2, B1)", () => {
  it("is named in each run's environmentObserved, and in no closure", SLOW, async () => {
    const notes: string[] = [];
    const adapter = await createNodeTestAdapter(PROJECT, {
      root,
      note: (text) => notes.push(text),
    });
    expect((await adapter.environment())[0]?.files).toEqual(["package.json", "scripts/setup.mjs"]);
    // Before any run the computed import is named, once.
    expect(notes.filter((n) => n.includes("scripts/setup.mjs:1:"))).toEqual([
      expect.stringMatching(/^node-test project "p": .*import\(\) with a computed specifier/),
    ]);

    const report = await adapter.run([A], {
      runId: "r",
      logDir: join(logs, randomUUID()),
      timeoutMs: 30_000,
    });
    expect(report).toMatchObject({ end: "completed", completedFiles: [A] });
    // Task 003-43: the report names what the preloads loaded, so the scheduler stores the run's
    // results only under an environment that holds it.
    expect(report.environmentObserved).toEqual([{ project: "p", paths: [HELPER] }]);

    // The core keeps it: the adapter's own environment and closures stay static.
    expect((await adapter.environment())[0]?.files).toEqual(["package.json", "scripts/setup.mjs"]);
    expect((await adapter.closure(A)).paths).not.toContain(HELPER);
    expect(report.observed?.[0]?.paths).not.toContain(HELPER);
    // Each run names the path again, keyed or not: the scheduler compares it with the key it ran under.
    const again = await adapter.run([A], {
      runId: "r2",
      logDir: join(logs, randomUUID()),
      timeoutMs: 30_000,
    });
    expect(again.environmentObserved).toEqual([{ project: "p", paths: [HELPER] }]);
  });
});
