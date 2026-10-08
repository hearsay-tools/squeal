import { randomUUID } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { NodeTestProject, RunnerAdapter } from "../../../src/core/types/index.js";
import { createNodeTestAdapter } from "../../../src/runners/node-test/adapter.js";

/**
 * Rows 003-37 and 004-19: what a test file's process loads belongs to that
 * file (spec 003 D3, D5; 004 D5). A module loaded through
 * `createRequire(<non-module>)` and what a process the test spawns loads join
 * that file's observed closure, not the project's preloads (lessons.md defect
 * 3); a slow project's spawned processes are recorded, a fast one's are not;
 * a file whose run loads nothing beyond itself and a manifest is named in a
 * note (defect 6).
 */

const FIXTURES = resolve(import.meta.dirname, "../../fixtures/node-test");
const SLOW = { timeout: 60_000 } as const;
const scratch = join(FIXTURES, ".tmp", randomUUID());
const logs = mkdtempSync(join(tmpdir(), "squeal-node-test-attribution-"));
afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
  rmSync(logs, { recursive: true, force: true });
});

function repo(name: string, files: Readonly<Record<string, string>>): string {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(scratch, name, path)), { recursive: true });
    writeFileSync(join(scratch, name, path), text);
  }
  return realpathSync(join(scratch, name));
}

const project = (more: Partial<NodeTestProject>): NodeTestProject => ({
  name: "p",
  node: process.execPath,
  argv: [],
  env: {},
  include: ["test/*.test.mjs"],
  ...more,
});

async function ran(adapter: RunnerAdapter, ...paths: string[]): Promise<void> {
  const files = paths.map((path) => ({ project: "p", path }));
  const report = await adapter.run(files, {
    runId: "r",
    logDir: join(logs, randomUUID()),
    timeoutMs: 30_000,
  });
  expect(report).toMatchObject({ end: "completed", completedFiles: files });
}

const affected = async (adapter: RunnerAdapter, path: string) => {
  const { direct, transitive } = await adapter.affected([path]);
  return [...direct, ...transitive].map((f) => f.path);
};

const TEST = `import { test } from "node:test";\n`;

describe("a createRequire load (lessons.md defect 3)", () => {
  it("joins the file that loaded it, and the preloads keep their own", SLOW, async () => {
    const root = repo("create-require", {
      "package.json": `${JSON.stringify({ name: "cr", private: true, type: "module" })}\n`,
      "scripts/setup.mjs": `await import("./marker" + ".mjs");\n`,
      "scripts/marker.mjs": "globalThis.marked = true;\n",
      "lib/release.cjs": "module.exports = { version: 1 };\n",
      "test/release.test.mjs": [
        `import { createRequire } from "node:module";`,
        `import { join } from "node:path";`,
        TEST,
        `const require = createRequire(join(process.cwd(), "package.json"));`,
        `test("loads", () => require("./lib/release.cjs"));`,
        "",
      ].join("\n"),
      "test/other.test.mjs": `${TEST}test("other", () => {});\n`,
    });
    const adapter = await createNodeTestAdapter(
      project({ argv: ["--import", "./scripts/setup.mjs"] }),
      { root },
    );
    await ran(adapter, "test/release.test.mjs", "test/other.test.mjs");
    await adapter.invalidate([{ path: "lib/release.cjs", kind: "change" }]);
    expect(await affected(adapter, "lib/release.cjs")).toEqual(["test/release.test.mjs"]);
    expect(
      (await adapter.closure({ project: "p", path: "test/release.test.mjs" })).paths,
    ).toContain("lib/release.cjs");
    const environment = (await adapter.environment())[0]?.files;
    expect(environment).not.toContain("lib/release.cjs");
    // The preload's computed import is still the preloads' (review wave 2, B1).
    expect(environment).toContain("scripts/marker.mjs");
  });
});

// Review 004 wave 1, S1 (row 003-39): a preload's `createRequire(package.json)` load has no loaded
// parent and a specifier no preload flag names; the recorder marks it as made before the test file.
describe("a preload's createRequire load (004 review S1)", () => {
  const CREATE_REQUIRE = [
    `const req = createRequire(process.cwd() + "/package.json");`,
    `req("./scripts/marker" + ".cjs");`,
    "",
  ].join("\n");
  const preloads = {
    "--require": [
      "scripts/create-require.cjs",
      `const { createRequire } = require("node:module");\n${CREATE_REQUIRE}`,
    ],
    "--import": [
      "scripts/create-require.mjs",
      `import { createRequire } from "node:module";\n${CREATE_REQUIRE}`,
    ],
  } as const;

  for (const [flag, [path, text]] of Object.entries(preloads)) {
    it(`stays with the ${flag} preload, out of both test closures`, SLOW, async () => {
      const root = repo(`preload-create-require${flag}`, {
        "package.json": `${JSON.stringify({ name: "pcr", private: true, type: "module" })}\n`,
        [path]: text,
        "scripts/marker.cjs": "globalThis.marked = true;\n",
        "test/a.test.mjs": `${TEST}test("a", () => {});\n`,
        "test/b.test.mjs": `${TEST}test("b", () => {});\n`,
      });
      const adapter = await createNodeTestAdapter(project({ argv: [flag, `./${path}`] }), {
        root,
      });
      await ran(adapter, "test/a.test.mjs", "test/b.test.mjs");
      expect((await adapter.environment())[0]?.files).toEqual(
        expect.arrayContaining([path, "scripts/marker.cjs"]),
      );
      for (const file of ["test/a.test.mjs", "test/b.test.mjs"]) {
        expect((await adapter.closure({ project: "p", path: file })).paths).toEqual([file]);
      }
    });
  }
});

describe("a test that spawns the package's CLI (spec 004 D5)", () => {
  const spawnRepo = (name: string) => {
    cpSync(join(FIXTURES, "spawn-cli"), join(scratch, name), { recursive: true });
    return realpathSync(join(scratch, name));
  };
  const FILE = "test/cli.test.mjs";

  it("in a slow project, keys the file with what the CLI loaded", SLOW, async () => {
    const root = spawnRepo("spawn-slow");
    const adapter = await createNodeTestAdapter(project({ slow: true }), { root });
    await ran(adapter, FILE);
    expect((await adapter.closure({ project: "p", path: FILE })).paths).toEqual(
      expect.arrayContaining(["bin/cli.mjs", "lib/helper.mjs"]),
    );
    expect(await affected(adapter, "lib/helper.mjs")).toEqual([FILE]);
    expect((await adapter.environment())[0]?.files).not.toContain("lib/helper.mjs");
  });

  it("in a fast project, observes nothing past the spawn and names the file", SLOW, async () => {
    const root = spawnRepo("spawn-fast");
    const notes: string[] = [];
    const adapter = await createNodeTestAdapter(project({}), {
      root,
      note: (text) => notes.push(text),
    });
    expect(notes.filter((n) => n.includes("inputs"))).toEqual([]);
    await ran(adapter, FILE);
    expect((await adapter.closure({ project: "p", path: FILE })).paths).not.toContain(
      "lib/helper.mjs",
    );
    expect(await affected(adapter, "lib/helper.mjs")).toEqual([]);
    expect(notes.filter((n) => n.includes("inputs"))).toEqual([
      `node-test project "p": 1 test file(s) loaded nothing beyond themselves and a manifest when they ran, so what they reach through a spawned process or a file read enters no key; declare it in inputs: ${FILE}`,
    ]);
  });
});

// Review 004 wave 1.5, S2 and S3 (row 003-40): only the project's own startup marks preloads. What an
// `eval` Worker, or a process the test spawns with a preload of its own, loads before its entry is
// the test file's, and an unrelated file beside it is not affected. A file-backed Worker is the control.
describe("a test-owned startup (004 re-review S2, S3)", () => {
  const OWN = [
    `const req = createRequire(process.cwd() + "/package.json");`,
    `req("./lib/" + "own.cjs");`,
  ].join("\n");
  const owned = {
    "an eval Worker's load": {
      "test/a.test.mjs": [
        `import { Worker } from "node:worker_threads";`,
        TEST,
        `test("a", async () => {`,
        `  const worker = new Worker(${JSON.stringify(`const { createRequire } = require("node:module");\n${OWN}`)}, { eval: true });`,
        `  await new Promise((done, fail) => worker.on("exit", done).on("error", fail));`,
        `});`,
        "",
      ].join("\n"),
    },
    "a file-backed Worker's load": {
      "lib/worker.cjs": `const { createRequire } = require("node:module");\n${OWN}\n`,
      "test/a.test.mjs": [
        `import { Worker } from "node:worker_threads";`,
        TEST,
        `test("a", async () => {`,
        `  const worker = new Worker(process.cwd() + "/lib/worker.cjs");`,
        `  await new Promise((done, fail) => worker.on("exit", done).on("error", fail));`,
        `});`,
        "",
      ].join("\n"),
    },
    "a spawned child's own --require": {
      "child-preload.cjs": `const { createRequire } = require("node:module");\n${OWN}\n`,
      "bin/cli.cjs": "",
      "test/a.test.mjs": [
        `import { spawnSync } from "node:child_process";`,
        TEST,
        `test("a", () => {`,
        `  const child = spawnSync(process.execPath, ["--require", "./child-preload.cjs", "./bin/cli.cjs"]);`,
        `  if (child.status !== 0) throw new Error(String(child.stderr));`,
        `});`,
        "",
      ].join("\n"),
    },
  };

  for (const [name, files] of Object.entries(owned)) {
    it(`keeps ${name} in that file's closure`, SLOW, async () => {
      const root = repo(`owned-${name.replace(/\W+/g, "-")}`, {
        "package.json": `${JSON.stringify({ name: "own", private: true, type: "module" })}\n`,
        "lib/own.cjs": "module.exports = 1;\n",
        "test/b.test.mjs": `${TEST}test("b", () => {});\n`,
        ...files,
      });
      const adapter = await createNodeTestAdapter(project({ slow: true }), { root });
      await ran(adapter, "test/a.test.mjs", "test/b.test.mjs");
      const own = [...Object.keys(files).filter((f) => f !== "test/a.test.mjs"), "lib/own.cjs"];
      const environment = (await adapter.environment())[0]?.files;
      for (const file of own) expect(environment).not.toContain(file);
      expect((await adapter.closure({ project: "p", path: "test/a.test.mjs" })).paths).toEqual(
        expect.arrayContaining(own),
      );
      expect((await adapter.closure({ project: "p", path: "test/b.test.mjs" })).paths).toEqual([
        "test/b.test.mjs",
      ]);
      await adapter.invalidate([{ path: "lib/own.cjs", kind: "change" }]);
      expect(await affected(adapter, "lib/own.cjs")).toEqual(["test/a.test.mjs"]);
    });
  }
});
