import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  nodeTestObservedPreloadsMetaKey,
  observedStore,
} from "../../../src/core/daemon/node-test-runners.js";
import type { NodeTestProject } from "../../../src/core/types/index.js";
import { createNodeTestAdapter } from "../../../src/runners/node-test/adapter.js";
import { fakeCommonDir, open } from "../../store/helpers.js";

/**
 * Review wave 2, B1: a file a preload loads through a computed `import()`
 * is in no static closure. After one run it is in the project's environment
 * files, `affected` treats it as a preload path, and every worktree of the
 * store reads it at start. Spec 003 D1 (the preloads' closure is an
 * environment input), D3, D5.
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
  it("enters the environment, every file's affected set and the store", SLOW, async () => {
    const store = open(fakeCommonDir());
    const notes: string[] = [];
    const adapter = await createNodeTestAdapter(PROJECT, {
      root,
      observed: observedStore(store, "p"),
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

    // As D3 has it for a test file's observed path, this worktree re-keys at the next edit
    // of the path: the scheduler reads the environment again for a recreated project.
    expect(await adapter.invalidate([{ path: "README.md", kind: "change" }])).toEqual({
      recreatedProjects: [],
    });
    expect(await adapter.invalidate([{ path: HELPER, kind: "change" }])).toEqual({
      recreatedProjects: ["p"],
    });
    expect(await adapter.affected([HELPER])).toEqual({ direct: [], transitive: [A] });
    expect((await adapter.environment())[0]?.files).toEqual([
      "package.json",
      HELPER,
      "scripts/setup.mjs",
    ]);
    // Keyed now: a later edit is an ordinary environment change.
    expect(await adapter.invalidate([{ path: HELPER, kind: "change" }])).toEqual({
      recreatedProjects: [],
    });
    expect((await adapter.closure(A)).paths).not.toContain(HELPER);
    expect(JSON.parse(store.meta.get(nodeTestObservedPreloadsMetaKey("p")) ?? "null")).toEqual([
      HELPER,
    ]);

    // Another worktree's adapter keys the project's environment with it from the start.
    const other = await createNodeTestAdapter(PROJECT, {
      root,
      observed: observedStore(store, "p"),
    });
    expect((await other.environment())[0]?.files).toContain(HELPER);
    expect((await other.affected([HELPER])).transitive).toEqual([A]);
  });
});
