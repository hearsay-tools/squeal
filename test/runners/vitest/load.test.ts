import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import Module, { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRecoveringRunner } from "../../../src/core/daemon/runner.js";
import { createVitestAdapter } from "../../../src/runners/vitest/index.js";
import { loadVitest } from "../../../src/runners/vitest/load.js";

/*
 * Review wave 3, B2 and spec 001 D11: "Squeal loads Vitest from the project
 * under validation, resolved from the worktree root and imported lazily by
 * the runner adapter, never from its own installation; a project without
 * Vitest is a runner failure state, not a crash."
 */

/** Node's CommonJS loader; `_initPaths` reads its global lookup paths, `NODE_PATH` among them. */
const cjs = Module as unknown as { _initPaths(): void };

/**
 * Row 017-11.R1: pnpm's `vitest` shim exports a `NODE_PATH` into its store, which the CommonJS
 * resolver `loadVitest` uses searches after the project's `node_modules` folders, so a project
 * without Vitest resolved the shim's. The loader reads `NODE_PATH` once at startup: this test
 * process's lookup paths are read again without it, as npm and Squeal start Vitest.
 */
function dropNodePath(): void {
  vi.stubEnv("NODE_PATH", undefined);
  cjs._initPaths();
}

beforeEach(dropNodePath);

const dirs: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  cjs._initPaths();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A project with no Vitest: under /tmp, since the OS temp dir can sit inside a checkout. */
function bareProject(): string {
  const dir = mkdtempSync("/tmp/sq-novitest-");
  dirs.push(dir);
  writeFileSync(join(dir, "package.json"), '{ "type": "module" }\n');
  return dir;
}

describe("loadVitest", () => {
  it("loads vitest/node as the project resolves it", async () => {
    const vitest = await loadVitest(process.cwd());
    expect(typeof vitest.createVitest).toBe("function");
    expect(vitest.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("rejects with a factual reason when the project has no Vitest", async () => {
    const root = bareProject();
    await expect(loadVitest(root)).rejects.toThrow(
      new RegExp(`vitest/node does not resolve from ${root}`),
    );
  });
});

describe("a project without Vitest", () => {
  it("is a runner failure with a note, not a crash", async () => {
    const root = bareProject();
    const notes: string[] = [];
    const runner = createRecoveringRunner({
      name: "vitest",
      adapterVersion: "test",
      create: () => createVitestAdapter({ root }),
      onFailure: (text) => notes.push(text),
    });

    expect(await runner.open()).toBe(false);
    expect(notes).toEqual([expect.stringContaining("vitest/node does not resolve")]);
    await expect(runner.testFiles()).rejects.toThrow(/vitest\/node does not resolve/);
    await runner.close();
  });
});

describe("the test process's NODE_PATH (row 017-11.R1)", () => {
  it("resolves no Vitest for a project without one once dropped, though it did before", async () => {
    const root = bareProject();
    vi.stubEnv("NODE_PATH", resolve(import.meta.dirname, "../../../node_modules"));
    cjs._initPaths();
    expect(() => createRequire(join(root, "package.json")).resolve("vitest/node")).not.toThrow();
    dropNodePath();
    await expect(loadVitest(root)).rejects.toThrow(/vitest\/node does not resolve/);
  });
});
