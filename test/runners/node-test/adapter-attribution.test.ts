import { randomUUID } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { NodeTestProject, RunnerAdapter, RunReport } from "../../../src/core/types/index.js";
import { createNodeTestAdapter } from "../../../src/runners/node-test/adapter.js";

/**
 * Rows 003-37 and 004-19: what a test file's process loads belongs to that
 * file (spec 003 D3, D5; 004 D5). A module loaded through
 * `createRequire(<non-module>)` and what a process the test spawns loads join
 * that file's observed paths, not the project's preloads (lessons.md defect
 * 3); a slow project's spawned processes are recorded, a fast one's are not;
 * a file whose run loads nothing beyond itself and a manifest is named in a
 * note (defect 6). Since spec 016 D4 the run reports them (`observed`,
 * `environmentObserved`) and the core keys them; what a spawned process
 * loaded is `direct` (row 007-56).
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

async function ran(adapter: RunnerAdapter, ...paths: string[]): Promise<RunReport> {
  const files = paths.map((path) => ({ project: "p", path }));
  const report = await adapter.run(files, {
    runId: "r",
    logDir: join(logs, randomUUID()),
    timeoutMs: 30_000,
  });
  expect(report).toMatchObject({ end: "completed", completedFiles: files });
  return report;
}

/** What `report` says the run of `path` loaded, and of that what a process it started loaded. */
const seen = (report: RunReport, path: string) => {
  const observed = report.observed?.find((o) => o.testFile.path === path);
  return { paths: observed?.paths ?? [], direct: observed?.direct ?? [] };
};

/** What `report` says the project's preloads loaded beyond their static closure. */
const startup = (report: RunReport) => report.environmentObserved?.flatMap((e) => e.paths) ?? [];

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
    const report = await ran(adapter, "test/release.test.mjs", "test/other.test.mjs");
    expect(seen(report, "test/release.test.mjs").paths).toContain("lib/release.cjs");
    expect(seen(report, "test/release.test.mjs").direct).toEqual([]);
    expect(seen(report, "test/other.test.mjs").paths).toEqual(["test/other.test.mjs"]);
    expect(startup(report)).not.toContain("lib/release.cjs");
    // The preload's computed import is still the preloads' (review wave 2, B1).
    expect(startup(report)).toEqual(["scripts/marker.mjs"]);
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
      const report = await ran(adapter, "test/a.test.mjs", "test/b.test.mjs");
      expect((await adapter.environment())[0]?.files).toContain(path);
      expect(startup(report)).toEqual(["scripts/marker.cjs"]);
      for (const file of ["test/a.test.mjs", "test/b.test.mjs"]) {
        expect(seen(report, file).paths).toEqual([file]);
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
    const report = await ran(adapter, FILE);
    expect(seen(report, FILE).paths).toEqual(
      expect.arrayContaining(["bin/cli.mjs", "lib/helper.mjs"]),
    );
    // 016 D4, row 007-56: what the CLI's process loaded puts the file in `direct`.
    expect(seen(report, FILE).direct).toEqual(
      expect.arrayContaining(["bin/cli.mjs", "lib/helper.mjs"]),
    );
    expect(startup(report)).not.toContain("lib/helper.mjs");
  });

  it("in a fast project, observes nothing past the spawn and names the file", SLOW, async () => {
    const root = spawnRepo("spawn-fast");
    const notes: string[] = [];
    const adapter = await createNodeTestAdapter(project({}), {
      root,
      note: (text) => notes.push(text),
    });
    expect(notes.filter((n) => n.includes("inputs"))).toEqual([]);
    const report = await ran(adapter, FILE);
    expect(seen(report, FILE).paths).not.toContain("lib/helper.mjs");
    expect(seen(report, FILE).direct).toEqual([]);
    expect(notes.filter((n) => n.includes("inputs"))).toEqual([bareNote(FILE)]);
  });
});

// Spec 016 D4, row 007-56 (the coordinator, Q5): a child's direct import of a path the test file
// reaches only through another module is `direct` too; the core keeps the mark on the closure path.
describe("a child's import of a path the static closure reaches through another module", () => {
  it("is direct in the run's report while the graph has it transitive", SLOW, async () => {
    const root = repo("child-through", {
      "package.json": `${JSON.stringify({ name: "through", private: true, type: "module" })}\n`,
      "lib/a.mjs": `export { b } from "./b.mjs";\n`,
      "lib/b.mjs": "export const b = 1;\n",
      "bin/child.mjs": `import { b } from "../lib/b.mjs";\nprocess.stdout.write(String(b));\n`,
      "test/t.test.mjs": [
        `import assert from "node:assert/strict";`,
        `import { execFileSync } from "node:child_process";`,
        `import { b } from "../lib/a.mjs";`,
        TEST,
        `test("t", () => assert.equal(execFileSync(process.execPath, ["bin/child.mjs"], { encoding: "utf8" }), String(b)));`,
        "",
      ].join("\n"),
    });
    const adapter = await createNodeTestAdapter(project({ slow: true }), { root });
    expect(await adapter.affected(["lib/b.mjs"])).toEqual({
      direct: [],
      transitive: [{ project: "p", path: "test/t.test.mjs" }],
    });
    const report = await ran(adapter, "test/t.test.mjs");
    expect(seen(report, "test/t.test.mjs").direct).toEqual(["bin/child.mjs", "lib/b.mjs"]);
  });
});

const bareNote = (files: string) =>
  `node-test project "p": ${files.split(", ").length} test file(s) loaded nothing beyond themselves and a manifest when they ran, so what they reach through a spawned process or a file read enters no key; declare it in inputs: ${files}`;

// Row 001-365 (005 lessons.md proposed row 3, gh-37): a bare file whose declared `inputs` cover it
// is not named, with no wording of its own, since a declaration does not prove every read is.
describe("a bare file's declared inputs (row 001-365)", () => {
  const BARE = `${TEST}test("bare", () => {});\n`;
  const [A, B] = ["test/a.test.mjs", "test/b.test.mjs"] as const;
  it.each([
    { name: "a map entry for one file", inputs: { "test/a.*": ["fixtures/**"] }, named: B },
    { name: "a map entry with no input glob", inputs: { "test/a.*": [] }, named: `${A}, ${B}` },
    { name: "an empty list", inputs: [], named: `${A}, ${B}` },
    { name: "a list", inputs: ["fixtures/**"], named: null },
  ])("$name: names only the files no declaration covers", SLOW, async ({ inputs, named }) => {
    const root = repo(`declared-${randomUUID()}`, {
      "package.json": `${JSON.stringify({ name: "bare", private: true, type: "module" })}\n`,
      [A]: BARE,
      [B]: BARE,
    });
    const notes: string[] = [];
    const adapter = await createNodeTestAdapter(project({}), {
      root,
      note: (text) => notes.push(text),
      inputs: () => inputs,
    });
    await ran(adapter, A, B);
    expect(notes.filter((n) => n.includes("inputs"))).toEqual(
      named === null ? [] : [bareNote(named)],
    );
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
      const report = await ran(adapter, "test/a.test.mjs", "test/b.test.mjs");
      const own = [...Object.keys(files).filter((f) => f !== "test/a.test.mjs"), "lib/own.cjs"];
      for (const file of own) expect(startup(report)).not.toContain(file);
      expect(seen(report, "test/a.test.mjs").paths).toEqual(expect.arrayContaining(own));
      expect(seen(report, "test/b.test.mjs").paths).toEqual(["test/b.test.mjs"]);
      // 016 D4: a Worker runs in the test file's process; a spawned child's loads are `direct`.
      expect(seen(report, "test/a.test.mjs").direct).toEqual(
        name.includes("spawned") ? own.sort() : [],
      );
    });
  }
});
