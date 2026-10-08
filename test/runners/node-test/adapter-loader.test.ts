import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  nodeTestObservedPreloadsMetaKey,
  observedStore,
} from "../../../src/core/daemon/node-test-runners.js";
import type { NodeTestProject } from "../../../src/core/types/index.js";
import { createNodeTestAdapter } from "../../../src/runners/node-test/adapter.js";
import { fakeCommonDir, open } from "../../store/helpers.js";

/**
 * Review wave 2.6, S1: on Node 22 the recorder, a `--require` preload, also
 * ran in the thread Node starts for async loader hooks, where a synchronous
 * hook cannot reach Node's resolution, and every test process beside an
 * async loader crashed. With the recorder present, an identity loader and a
 * transforming one run as they do without Squeal, on the loader's every
 * spelling, and a `--require` preload's computed load is still observed.
 * What the loader thread loads is not observed: one note per project.
 */

const FIXTURES = resolve(import.meta.dirname, "../../fixtures/node-test");
const SLOW = { timeout: 60_000 } as const;
const scratch = join(FIXTURES, ".tmp", randomUUID());
const logs = mkdtempSync(join(tmpdir(), "squeal-node-test-loader-"));
afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
  rmSync(logs, { recursive: true, force: true });
});

const FILES: Readonly<Record<string, string>> = {
  "package.json": `${JSON.stringify({ name: "loader", private: true, type: "module" })}\n`,
  "loaders/identity.mjs": [
    "export async function resolve(specifier, context, nextResolve) {",
    "  return nextResolve(specifier, context);",
    "}",
    "",
  ].join("\n"),
  // Replaces `__VALUE__` in test files, so the test passes only through the loader.
  "loaders/transform.mjs": [
    "export async function load(url, context, nextLoad) {",
    "  const loaded = await nextLoad(url, context);",
    `  if (!url.endsWith(".test.mjs")) return loaded;`,
    `  return { ...loaded, source: String(loaded.source).replace("__VALUE__", "1") };`,
    "}",
    "",
  ].join("\n"),
  "loaders/register.mjs": [
    `import { register } from "node:module";`,
    `register("./identity.mjs", import.meta.url);`,
    "",
  ].join("\n"),
  "scripts/setup.cjs": `require("./helper" + ".cjs");\n`,
  "scripts/helper.cjs": "globalThis.helperValue = 1;\n",
  "test/identity.test.mjs": [
    `import assert from "node:assert/strict";`,
    `import { test } from "node:test";`,
    `test("the preload's helper ran", () => assert.equal(globalThis.helperValue, 1));`,
    "",
  ].join("\n"),
  "test/transform.test.mjs": [
    `import assert from "node:assert/strict";`,
    `import { test } from "node:test";`,
    `test("the loader transformed the file", () => assert.equal(__VALUE__, globalThis.helperValue));`,
    "",
  ].join("\n"),
};

interface Case {
  readonly name: string;
  readonly argv: readonly string[];
  readonly nodeOptions?: string;
  readonly test: "identity" | "transform";
  /** The loader the note names; none for `module.register`, which no flag shows. */
  readonly loader: string | null;
}

const SETUP = ["--require", "./scripts/setup.cjs"];
const CASES: readonly Case[] = [
  {
    name: "an identity --loader",
    argv: [...SETUP, "--loader", "./loaders/identity.mjs"],
    test: "identity",
    loader: "./loaders/identity.mjs",
  },
  {
    name: "an identity --experimental-loader=",
    argv: [...SETUP, "--experimental-loader=./loaders/identity.mjs"],
    test: "identity",
    loader: "./loaders/identity.mjs",
  },
  {
    name: "a transforming --loader",
    argv: [...SETUP, "--loader", "./loaders/transform.mjs"],
    test: "transform",
    loader: "./loaders/transform.mjs",
  },
  {
    name: "a transforming loader and the preload in NODE_OPTIONS",
    argv: [],
    nodeOptions: '--loader ./loaders/transform.mjs "--require" ./scripts/setup.cjs',
    test: "transform",
    loader: "./loaders/transform.mjs",
  },
  {
    name: "module.register from an --import preload",
    argv: [...SETUP, "--import", "./loaders/register.mjs"],
    test: "identity",
    loader: null,
  },
];

function repo(): string {
  const dir = join(scratch, randomUUID());
  for (const [path, text] of Object.entries(FILES)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  return realpathSync(dir);
}

describe("the recorder beside an async loader (review wave 2.6, S1)", () => {
  it.each(CASES)("$name: runs, observes the preload's helper, notes", SLOW, async (c) => {
    const root = repo();
    const project: NodeTestProject = {
      name: "p",
      node: process.execPath,
      argv: c.argv,
      env: c.nodeOptions === undefined ? {} : { NODE_OPTIONS: c.nodeOptions },
      include: [`test/${c.test}.test.mjs`],
    };
    const store = open(fakeCommonDir());
    const notes: string[] = [];
    const adapter = await createNodeTestAdapter(project, {
      root,
      observed: observedStore(store, "p"),
      note: (text) => notes.push(text),
    });
    const file = { project: "p", path: `test/${c.test}.test.mjs` };
    const report = await adapter.run([file], {
      runId: "r",
      logDir: join(logs, randomUUID()),
      timeoutMs: 30_000,
    });
    expect(report).toMatchObject({ end: "completed", completedFiles: [file], failure: null });
    expect(report.results.map((r) => r.outcome)).toEqual(["pass"]);
    expect(JSON.parse(store.meta.get(nodeTestObservedPreloadsMetaKey("p")) ?? "[]")).toContain(
      "scripts/helper.cjs",
    );

    const loaderNotes = notes.filter((n) => n.includes("loader thread"));
    if (c.loader === null) expect(loaderNotes).toEqual([]);
    else {
      expect(loaderNotes).toEqual([
        `node-test project "p": async loader ${JSON.stringify(c.loader)}: Squeal does not record in Node's loader thread, so what the loader loads enters no key; declare it in inputs`,
      ]);
    }
  });
});
