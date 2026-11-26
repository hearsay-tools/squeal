import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it, onTestFinished } from "vitest";
import { squealVersion } from "../../../src/core/daemon/version.js";
import { createHostedJest } from "../../../src/core/runner-host/process-host.js";
import type { AbsolutePath } from "../../../src/core/types/common.js";
import type { TestFileRef } from "../../../src/core/types/keys.js";
import type { JestProject } from "../../../src/core/types/policy-jest.js";
import type { RunnerAdapter, RunReport } from "../../../src/core/types/runner.js";
import { createJestAdapter } from "../../../src/runners/jest/index.js";
import { resolveJest } from "../../../src/runners/jest/resolve.js";
import { installJest, JEST_MAJORS, type JestMajor } from "../../helpers/jest-env.js";
import { sourceHost } from "../../runner-host/process-helpers.js";

/*
 * Spec 028 D6 (row 028-05): the Jest adapter's whole lifecycle on real Jest
 * 29.7.0 and 30.5.2: listing, static closure and `affected`, enumeration,
 * `invalidate`, a run that reports `loaded` and `observed`, and the same
 * answers from a runner host.
 */

const PROJECT: JestProject = {
  name: "app",
  config: "jest.config.js",
  include: [],
  exclude: ["test/skipped.test.js"],
  args: [],
  env: {},
};

const CONFIG = (extra = "") => `module.exports = {
  testEnvironment: "node",
  testMatch: ["<rootDir>/test/**/*.test.js"],
  setupFiles: ["<rootDir>/setup/env.js"],${extra}
};
`;

const FILES: Readonly<Record<string, string>> = {
  "package.json": `{ "name": "app", "private": true }\n`,
  "jest.config.js": CONFIG(),
  "setup/env.js": "globalThis.ready = true;\n",
  "src/sum.js": "exports.sum = (a, b) => a + b;\n",
  "src/other.js": "exports.other = 2;\n",
  "data/input.txt": "3\n",
  "test/sum.test.js": `const fs = require("fs");
const path = require("path");
const { sum } = require("../src/sum");
describe("sum", () => {
  test("adds", () => {
    const want = Number(fs.readFileSync(path.join(__dirname, "../data/input.txt"), "utf8"));
    expect(sum(1, 2)).toBe(want);
  });
  test.each([[1], [2]])("each %i", (n) => expect(n).toBeGreaterThan(0));
});
`,
  "test/other.test.js": `const { other } = require("../src/other");\ntest("other", () => expect(other).toBe(2));\n`,
  "test/skipped.test.js": `test("never listed", () => {});\n`,
};

const scratch = realpathSync(mkdtempSync(join(tmpdir(), "squeal-jest-adapter-")));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));
let made = 0;

function worktree(major: JestMajor): AbsolutePath {
  const root = join(scratch, `tree-${made++}`);
  for (const [path, text] of Object.entries(FILES)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  mkdirSync(join(root, "node_modules"));
  const installed = realpathSync(join(installJest(major), "node_modules/jest"));
  symlinkSync(installed, join(root, "node_modules/jest"));
  return root as AbsolutePath;
}

const ref = (path: string): TestFileRef => ({ project: "app", path });
const SUM = ref("test/sum.test.js");
const OTHER = ref("test/other.test.js");
const SLOW = { timeout: 240_000 };

async function runAll(adapter: RunnerAdapter, root: string, at: number): Promise<RunReport> {
  return adapter.run([SUM, OTHER], {
    runId: `run-${at}`,
    logDir: join(root, "..", `logs-${made}-${at}`) as AbsolutePath,
    timeoutMs: 120_000,
  });
}

describe.each(JEST_MAJORS)("the Jest %i adapter (spec 028 D6)", (major) => {
  it("lists, closes over, enumerates and selects statically", SLOW, async () => {
    const root = worktree(major);
    const adapter = await createJestAdapter(PROJECT, { root });
    expect(await adapter.testFiles()).toEqual([OTHER, SUM]);
    const closure = await adapter.closure(SUM);
    expect(closure.paths).toEqual(
      expect.arrayContaining([
        "test/sum.test.js",
        "src/sum.js",
        "setup/env.js",
        "test/__snapshots__/sum.test.js.snap",
      ]),
    );
    expect(closure.paths).not.toContain("src/other.js");
    expect(await adapter.affected(["src/sum.js"])).toEqual({ direct: [SUM], transitive: [] });
    // A setup file reaches every test file.
    const setup = await adapter.affected(["setup/env.js"]);
    expect(
      [...setup.direct, ...setup.transitive].sort((a, b) => a.path.localeCompare(b.path)),
    ).toEqual([OTHER, SUM]);
    const checks = await adapter.enumerate(SUM);
    expect(checks.map((c) => [c.check.fullName, c.templated])).toEqual([
      ["sum > adds", false],
      ["sum > each %i", true],
    ]);
  });

  it("runs, reporting what each file loaded and read", SLOW, async () => {
    const root = worktree(major);
    const adapter = await createJestAdapter(PROJECT, { root });
    const report = await runAll(adapter, root, 0);
    expect(report.end).toBe("completed");
    expect(report.completedFiles).toEqual(expect.arrayContaining([SUM, OTHER]));
    const outcomes = Object.fromEntries(report.results.map((r) => [r.check.fullName, r.outcome]));
    expect(outcomes).toEqual({
      "sum > adds": "pass",
      "sum > each 1": "pass",
      "sum > each 2": "pass",
      other: "pass",
    });
    const loaded = report.loaded?.find((l) => l.testFile.path === SUM.path)?.paths ?? [];
    expect(loaded).toEqual(expect.arrayContaining(["test/sum.test.js", "src/sum.js"]));
    const read = report.observed?.find((o) => o.testFile.path === SUM.path)?.paths ?? [];
    expect(read).toContain("data/input.txt");
    expect(report.observed?.find((o) => o.testFile.path === OTHER.path)?.paths ?? []).not.toContain(
      "data/input.txt",
    );
  });

  it("observes nothing through the recorder when observe.runtimeInputs is off", SLOW, async () => {
    const root = worktree(major);
    const adapter = await createJestAdapter(PROJECT, { root, observe: () => false });
    const report = await runAll(adapter, root, 0);
    expect(report.end).toBe("completed");
    expect(report.observed).toBeUndefined();
    expect(report.loaded?.length).toBeGreaterThan(0);
  });

  it(
    "lists an added test file, and recreates the project when its config changes",
    SLOW,
    async () => {
      const root = worktree(major);
      let observe = true;
      const adapter = await createJestAdapter(PROJECT, { root, observe: () => observe });
      writeFileSync(join(root, "src/sum.js"), "exports.sum = (a, b) => a + b + 0;\n");
      expect(await adapter.invalidate([{ path: "src/sum.js", kind: "change" }])).toEqual({
        recreatedProjects: [],
      });
      writeFileSync(join(root, "test/added.test.js"), `test("added", () => {});\n`);
      expect(await adapter.invalidate([{ path: "test/added.test.js", kind: "add" }])).toEqual({
        recreatedProjects: [],
      });
      expect(await adapter.testFiles()).toEqual([ref("test/added.test.js"), OTHER, SUM]);
      const before = (await adapter.environment())[0]?.resolvedConfig;
      writeFileSync(join(root, "jest.config.js"), CONFIG("\n  testTimeout: 9000,"));
      expect(await adapter.invalidate([{ path: "jest.config.js", kind: "change" }])).toEqual({
        recreatedProjects: ["app"],
      });
      expect((await adapter.environment())[0]?.resolvedConfig).not.toBe(before);
      observe = false;
      expect(await adapter.invalidate([])).toEqual({ recreatedProjects: ["app"] });
    },
  );

  it("answers the same from a runner host", SLOW, async () => {
    const root = worktree(major);
    const here = await createJestAdapter(PROJECT, { root });
    const hosted = await createHostedJest(sourceHost(squealVersion()), PROJECT, { root });
    onTestFinished(() => hosted.close());
    expect(hosted.name).toBe("jest");
    expect(await hosted.testFiles()).toEqual(await here.testFiles());
    expect(await hosted.closure(SUM)).toEqual(await here.closure(SUM));
    expect(await hosted.environment()).toEqual(await here.environment());
    const report = await runAll(hosted, root, 1);
    expect(report.end).toBe("completed");
    expect(report.results.every((r) => r.outcome === "pass")).toBe(true);
    expect(report.observed?.find((o) => o.testFile.path === SUM.path)?.paths).toContain(
      "data/input.txt",
    );
  });
});

/*
 * Review 0.1.644 B4: a module the config imports is part of its chain. Its
 * edit recreates the project, and the live adapter then answers as a fresh one.
 */
describe.each(JEST_MAJORS)("the Jest %i adapter's imported config files (B4)", (major) => {
  const changed = (path: string) => [{ path, kind: "change" as const }];

  /** A worktree whose config is `config`, with `files` beside it. */
  function imported(config: string, files: Record<string, string>): AbsolutePath {
    const root = worktree(major);
    writeFileSync(join(root, "jest.config.js"), config);
    for (const [path, text] of Object.entries(files)) writeFileSync(join(root, path), text);
    return root;
  }

  /** The live adapter answers what a freshly opened adapter on the same files answers. */
  async function expectFresh(
    live: RunnerAdapter,
    root: AbsolutePath,
    project: JestProject = PROJECT,
  ): Promise<void> {
    const fresh = await createJestAdapter(project, { root });
    expect(await live.environment()).toEqual(await fresh.environment());
    expect(await live.testFiles()).toEqual(await fresh.testFiles());
    expect(await live.affected(["src/sum.js", "src/other.js"])).toEqual(
      await fresh.affected(["src/sum.js", "src/other.js"]),
    );
    expect(await live.closure(SUM)).toEqual(await fresh.closure(SUM));
  }

  it("recreates the project when an imported helper changes a scalar option", SLOW, async () => {
    const root = imported(CONFIG(`\n  ...require("./options.cjs"),`), {
      "options.cjs": "module.exports = { testTimeout: 1000 };\n",
    });
    const adapter = await createJestAdapter(PROJECT, { root });
    const [before] = await adapter.environment();
    expect(before?.files).toContain("options.cjs");
    writeFileSync(join(root, "options.cjs"), "module.exports = { testTimeout: 9000 };\n");
    expect(await adapter.invalidate(changed("options.cjs"))).toEqual({
      recreatedProjects: ["app"],
    });
    expect((await adapter.environment())[0]?.resolvedConfig).not.toBe(before?.resolvedConfig);
    await expectFresh(adapter, root);
  });

  it("follows a nested helper chain into testMatch and moduleNameMapper", SLOW, async () => {
    const root = imported(
      `module.exports = { testEnvironment: "node", ...require("./a.cjs") };\n`,
      {
        "a.cjs": `module.exports = { setupFiles: ["<rootDir>/setup/env.js"], ...require("./b.cjs") };\n`,
        "b.cjs": `module.exports = { testMatch: ["<rootDir>/test/**/*.test.js"] };\n`,
        "src/alias.js": "exports.sum = (a, b) => a + b;\n",
      },
    );
    const adapter = await createJestAdapter(PROJECT, { root });
    const [before] = await adapter.environment();
    expect(before?.files).toEqual(expect.arrayContaining(["a.cjs", "b.cjs"]));
    expect(await adapter.testFiles()).toEqual([OTHER, SUM]);
    writeFileSync(
      join(root, "b.cjs"),
      `module.exports = {
  testMatch: ["<rootDir>/test/sum.test.js"],
  moduleNameMapper: { "^\\\\.\\\\./src/sum$": "<rootDir>/src/alias.js" },
};
`,
    );
    expect(await adapter.invalidate(changed("b.cjs"))).toEqual({ recreatedProjects: ["app"] });
    expect(await adapter.testFiles()).toEqual([SUM]);
    expect(await adapter.affected(["src/alias.js"])).toEqual({ direct: [SUM], transitive: [] });
    await expectFresh(adapter, root);
  });

  it("recovers when a helper that threw is fixed", SLOW, async () => {
    const root = imported(CONFIG(`\n  ...require("./options.cjs"),`), {
      "options.cjs": `throw new Error("not yet");\n`,
    });
    const notes: string[] = [];
    const adapter = await createJestAdapter(PROJECT, { root, note: (text) => notes.push(text) });
    const [broken] = await adapter.environment();
    expect(broken?.runnerVersion).toBe("unavailable");
    expect(broken?.files).toContain("options.cjs");
    expect(await adapter.testFiles()).toEqual([]);
    expect(notes).toEqual([expect.stringMatching(/not yet/)]);
    // Any edit reads it again; still broken, it keys as it did.
    expect(await adapter.invalidate(changed("src/sum.js"))).toEqual({ recreatedProjects: [] });
    expect(notes).toHaveLength(1);
    writeFileSync(join(root, "options.cjs"), "module.exports = { testTimeout: 9000 };\n");
    expect(await adapter.invalidate(changed("options.cjs"))).toEqual({
      recreatedProjects: ["app"],
    });
    expect((await adapter.environment())[0]?.runnerVersion).toMatch(new RegExp(`^${major}\\.`));
    await expectFresh(adapter, root);
  });

  /*
   * Reviews 0.1.644-r2 and -r3 B4: a helper deleted and restored, or missing
   * at the start. Nothing guesses the missing path: an unavailable project
   * reads again on any edit, a healthy one only on its config chain.
   */
  const added = (path: string) => [{ path, kind: "add" as const }];
  const deleted = (path: string) => [{ path, kind: "delete" as const }];
  const healthy = new RegExp(`^${major}\\.`);

  it("recovers when a deleted CJS helper is restored", SLOW, async () => {
    const root = imported(CONFIG(`\n  ...require("./options.cjs"),`), {
      "options.cjs": "module.exports = { testTimeout: 1000 };\n",
    });
    const adapter = await createJestAdapter(PROJECT, { root });
    const [before] = await adapter.environment();
    rmSync(join(root, "options.cjs"));
    expect(await adapter.invalidate(deleted("options.cjs"))).toEqual({
      recreatedProjects: ["app"],
    });
    const [broken] = await adapter.environment();
    expect(broken?.runnerVersion).toBe("unavailable");
    expect(broken?.files).not.toContain("options.cjs");
    expect(await adapter.testFiles()).toEqual([]);
    // An unrelated edit reads it again; still broken, it keys as it did.
    expect(await adapter.invalidate(changed("src/sum.js"))).toEqual({ recreatedProjects: [] });
    writeFileSync(join(root, "options.cjs"), "module.exports = { testTimeout: 9000 };\n");
    expect(await adapter.invalidate(added("options.cjs"))).toEqual({
      recreatedProjects: ["app"],
    });
    const [after] = await adapter.environment();
    expect(after?.runnerVersion).toMatch(healthy);
    expect(after?.resolvedConfig).not.toBe(before?.resolvedConfig);
    expect(after?.resolvedConfig).toContain('"testTimeout":9000');
    expect(await adapter.testFiles()).toEqual([OTHER, SUM]);
    await expectFresh(adapter, root);
    // Healthy again: a source edit, or a path the failed read missed, reopens nothing.
    writeFileSync(join(root, "src/sum.js"), "exports.sum = (a, b) => b + a;\n");
    expect(await adapter.invalidate(changed("src/sum.js"))).toEqual({ recreatedProjects: [] });
    expect(await adapter.invalidate(added("options.cjs.js"))).toEqual({ recreatedProjects: [] });
  });

  it("recovers when helpers missing at the start are created", SLOW, async () => {
    const root = imported(
      CONFIG(`
  ...require("./options.cjs"),
  ...JSON.parse(require("fs").readFileSync("./options.json", "utf8")),`),
      {},
    );
    const notes: string[] = [];
    const adapter = await createJestAdapter(PROJECT, { root, note: (text) => notes.push(text) });
    const [missing] = await adapter.environment();
    expect(missing?.runnerVersion).toBe("unavailable");
    writeFileSync(join(root, "options.cjs"), "module.exports = { testTimeout: 9000 };\n");
    // The require now succeeds and the read fails on the next missing file.
    expect(await adapter.invalidate(added("options.cjs"))).toEqual({ recreatedProjects: [] });
    const [half] = await adapter.environment();
    expect(half?.files).toContain("options.cjs");
    expect(half?.files).not.toContain("options.json");
    expect(notes).toEqual([
      expect.stringMatching(/options\.cjs/),
      expect.stringMatching(/options\.json/),
    ]);
    writeFileSync(join(root, "options.json"), `{ "bail": 1 }\n`);
    expect(await adapter.invalidate(added("options.json"))).toEqual({
      recreatedProjects: ["app"],
    });
    const [after] = await adapter.environment();
    expect(after?.runnerVersion).toMatch(healthy);
    expect(after?.resolvedConfig).toContain('"testTimeout":9000');
    expect(await adapter.testFiles()).toEqual([OTHER, SUM]);
    await expectFresh(adapter, root);
  });

  it("recovers when a deleted ESM helper is restored", SLOW, async () => {
    const esm: JestProject = { ...PROJECT, config: "jest.config.mjs" };
    const root = imported(CONFIG(), {
      "jest.config.mjs": `import options from "./options.mjs";
export default {
  testEnvironment: "node",
  testMatch: ["<rootDir>/test/**/*.test.js"],
  setupFiles: ["<rootDir>/setup/env.js"],
  ...options,
};
`,
      "options.mjs": "export default { testTimeout: 1000 };\n",
    });
    const adapter = await createJestAdapter(esm, { root });
    expect((await adapter.environment())[0]?.files).toContain("options.mjs");
    rmSync(join(root, "options.mjs"));
    expect(await adapter.invalidate(deleted("options.mjs"))).toEqual({
      recreatedProjects: ["app"],
    });
    const [broken] = await adapter.environment();
    expect(broken?.runnerVersion).toBe("unavailable");
    expect(broken?.files).not.toContain("options.mjs");
    writeFileSync(join(root, "options.mjs"), "export default { testTimeout: 9000 };\n");
    expect(await adapter.invalidate(added("options.mjs"))).toEqual({
      recreatedProjects: ["app"],
    });
    const [after] = await adapter.environment();
    expect(after?.runnerVersion).toMatch(healthy);
    expect(after?.resolvedConfig).toContain('"testTimeout":9000');
    expect(await adapter.testFiles()).toEqual([OTHER, SUM]);
    await expectFresh(adapter, root, esm);
  });

  // Review 0.1.644-r3 B4: `require("./options")` resolves to a folder's `index.js`.
  it.each([
    ["an empty options/ folder", true],
    ["no options/ folder", false],
  ])("recovers when a missing directory import is created, with %s", SLOW, async (_, folder) => {
    const root = imported(CONFIG(`\n  ...require("./options"),`), {});
    if (folder) mkdirSync(join(root, "options"));
    const adapter = await createJestAdapter(PROJECT, { root });
    expect((await adapter.environment())[0]?.runnerVersion).toBe("unavailable");
    expect(await adapter.testFiles()).toEqual([]);
    mkdirSync(join(root, "options"), { recursive: true });
    writeFileSync(join(root, "options/index.js"), "module.exports = { testTimeout: 9000 };\n");
    expect(await adapter.invalidate(added("options/index.js"))).toEqual({
      recreatedProjects: ["app"],
    });
    const [after] = await adapter.environment();
    expect(after?.runnerVersion).toMatch(healthy);
    expect(after?.resolvedConfig).toContain('"testTimeout":9000');
    expect(after?.files).toContain("options/index.js");
    expect(await adapter.testFiles()).toEqual([OTHER, SUM]);
    await expectFresh(adapter, root);
    writeFileSync(join(root, "src/sum.js"), "exports.sum = (a, b) => b + a;\n");
    expect(await adapter.invalidate(changed("src/sum.js"))).toEqual({ recreatedProjects: [] });
    // The helper is in the chain now: its edit reads the config again.
    writeFileSync(join(root, "options/index.js"), "module.exports = { testTimeout: 1000 };\n");
    expect(await adapter.invalidate(changed("options/index.js"))).toEqual({
      recreatedProjects: ["app"],
    });
    expect((await adapter.environment())[0]?.resolvedConfig).toContain('"testTimeout":1000');
  });

  it("recovers when a missing directory import is created with a package main", SLOW, async () => {
    const root = imported(CONFIG(`\n  ...require("./options"),`), {});
    const adapter = await createJestAdapter(PROJECT, { root });
    expect((await adapter.environment())[0]?.runnerVersion).toBe("unavailable");
    mkdirSync(join(root, "options"));
    writeFileSync(join(root, "options/package.json"), `{ "main": "./custom.cjs" }\n`);
    // Its main is still missing: the read fails again.
    expect(await adapter.invalidate(added("options/package.json"))).toEqual({
      recreatedProjects: [],
    });
    writeFileSync(join(root, "options/custom.cjs"), "module.exports = { testTimeout: 9000 };\n");
    expect(await adapter.invalidate(added("options/custom.cjs"))).toEqual({
      recreatedProjects: ["app"],
    });
    const [after] = await adapter.environment();
    expect(after?.runnerVersion).toMatch(healthy);
    expect(after?.resolvedConfig).toContain('"testTimeout":9000');
    expect(after?.files).toContain("options/custom.cjs");
    expect(await adapter.testFiles()).toEqual([OTHER, SUM]);
    await expectFresh(adapter, root);
    writeFileSync(join(root, "src/sum.js"), "exports.sum = (a, b) => b + a;\n");
    expect(await adapter.invalidate(changed("src/sum.js"))).toEqual({ recreatedProjects: [] });
  });
});

/** Review 0.1.646 B2: a root config of a folder glob and inline project objects. */
const INLINE: Readonly<Record<string, string>> = {
  "package.json": `{ "name": "app", "private": true }\n`,
  "jest.config.cjs": `const kinds = require("./tools/kinds.cjs");
module.exports = {
  projects: [
    "<rootDir>/packages/*",
    { displayName: "unit", testEnvironment: "node", testMatch: ["<rootDir>/unit/*.test.cjs"],
      setupFiles: ["<rootDir>/setup/env.js"], globals: { KIND: kinds.unit } },
    { displayName: "integration", rootDir: "integration", testEnvironment: "node",
      testMatch: ["<rootDir>/*.test.cjs"], globals: { KIND: kinds.integration } },
  ],
};
`,
  "tools/kinds.cjs": `module.exports = { unit: "unit", integration: "integration" };\n`,
  "setup/env.js": "globalThis.ready = true;\n",
  "src/sum.js": "exports.sum = (a, b) => a + b;\n",
  "unit/a.test.cjs": `const { sum } = require("../src/sum");
test("unit", () => {
  expect(KIND).toBe("unit");
  expect(globalThis.ready).toBe(true);
  expect(sum(1, 2)).toBe(3);
});
`,
  "integration/b.test.cjs": `test("integration", () => {
  expect(KIND).toBe("integration");
  expect(globalThis.ready).toBeUndefined();
});
`,
  "packages/p/jest.config.cjs": `module.exports = { testEnvironment: "node" };\n`,
  "packages/p/p.test.js": `test("p", () => expect(typeof KIND).toBe("undefined"));\n`,
};

describe.each(JEST_MAJORS)("the Jest %i adapter on inline projects (B2)", (major) => {
  function inlineTree(): AbsolutePath {
    const root = join(scratch, `tree-${made++}`);
    for (const [path, text] of Object.entries(INLINE)) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), text);
    }
    mkdirSync(join(root, "node_modules"));
    const installed = realpathSync(join(installJest(major), "node_modules/jest"));
    symlinkSync(installed, join(root, "node_modules/jest"));
    return root as AbsolutePath;
  }
  const project = (name: string, config: string, selector?: string): JestProject => ({
    name,
    config,
    ...(selector === undefined ? {} : { project: selector }),
    include: [],
    exclude: [],
    args: [],
    env: {},
  });
  const PROJECTS = [
    project("unit", "jest.config.cjs", "unit"),
    project("integration", "jest.config.cjs", "integration"),
    project("p", "packages/p/jest.config.cjs"),
  ];

  it(
    "lists what jest --config lists, runs each with its options, keys each apart",
    SLOW,
    async () => {
      const root = inlineTree();
      const resolution = resolveJest("app", root, root);
      if (!resolution.ok) throw new Error(resolution.note);
      const jest = [resolution.install.bin, "--config", "jest.config.cjs", "--listTests", "--json"];
      const out = execFileSync(process.execPath, jest, { cwd: root, encoding: "utf8" });
      const listed = (JSON.parse(out) as string[]).map((path) => path.slice(root.length + 1));
      const ours: string[] = [];
      const keys = new Set<string>();
      for (const [at, each] of PROJECTS.entries()) {
        const adapter = await createJestAdapter(each, { root });
        const files = await adapter.testFiles();
        expect(files).toHaveLength(1);
        ours.push(...files.map((f) => f.path));
        const report = await adapter.run(files, {
          runId: `inline-${at}`,
          logDir: join(root, "..", `logs-${made}-inline-${at}`) as AbsolutePath,
          timeoutMs: 120_000,
        });
        expect(report.end).toBe("completed");
        expect(report.completedFiles).toEqual(files);
        expect(report.results.map((r) => [r.check.fullName, r.outcome])).toEqual([
          [each.name, "pass"],
        ]);
        const loaded = report.loaded?.[0]?.paths ?? [];
        expect(loaded).toContain(files[0]?.path);
        const [environment] = await adapter.environment();
        keys.add(environment?.resolvedConfig ?? "");
      }
      expect(ours.sort()).toEqual(listed.sort());
      expect(ours).toEqual(["integration/b.test.cjs", "packages/p/p.test.js", "unit/a.test.cjs"]);
      expect(keys.size).toBe(PROJECTS.length);
    },
  );

  it(
    "recreates an inline project when a helper its root config imports changes",
    SLOW,
    async () => {
      const root = inlineTree();
      const unit = PROJECTS[0] as JestProject;
      const adapter = await createJestAdapter(unit, { root });
      const [before] = await adapter.environment();
      expect(before?.files).toEqual(expect.arrayContaining(["jest.config.cjs", "tools/kinds.cjs"]));
      writeFileSync(
        join(root, "tools/kinds.cjs"),
        `module.exports = { unit: "renamed", integration: "integration" };\n`,
      );
      const changed = [{ path: "tools/kinds.cjs", kind: "change" as const }];
      expect(await adapter.invalidate(changed)).toEqual({ recreatedProjects: ["unit"] });
      const [after] = await adapter.environment();
      expect(after?.resolvedConfig).not.toBe(before?.resolvedConfig);
      expect(after?.resolvedConfig).toContain(`"KIND":"renamed"`);
      const fresh = await createJestAdapter(unit, { root });
      expect(await fresh.environment()).toEqual([after]);
    },
  );

  it(
    "keeps root global options (testTimeout, globalSetup) without leaking root project globals (review 0.1.646-r2 B2)",
    SLOW,
    async () => {
      const root = join(scratch, `tree-${made++}`) as AbsolutePath;
      const files: Record<string, string> = {
        "package.json": `{ "name": "app", "private": true }\n`,
        "global-setup.cjs": `const fs = require("fs");
const path = require("path");
module.exports = () => {
  fs.writeFileSync(path.join(__dirname, "global-setup.ran"), "yes");
};
`,
        "jest.config.cjs": `module.exports = {
  testTimeout: 25,
  globalSetup: "<rootDir>/global-setup.cjs",
  globals: { ROOT_ONLY: "leak" },
  projects: [
    {
      displayName: "unit",
      rootDir: ".",
      testEnvironment: "node",
      testMatch: ["<rootDir>/unit/*.test.cjs"],
      globals: { KIND: "unit" },
    },
    {
      displayName: "other",
      rootDir: ".",
      testEnvironment: "node",
      testMatch: ["<rootDir>/other/*.test.cjs"],
    },
  ],
};
`,
        "unit/helper.cjs": `module.exports = 42;\n`,
        "unit/slow.test.cjs": `test("respects root timeout", async () => {
  await new Promise((resolve) => setTimeout(resolve, 150));
});
`,
        "unit/fast.test.cjs": `const value = require("./helper.cjs");
test("keeps inline globals without root globals", () => {
  expect(KIND).toBe("unit");
  expect(typeof ROOT_ONLY).toBe("undefined");
  expect(value).toBe(42);
});
`,
        "other/skip.test.cjs": `test("other", () => expect(1).toBe(1));\n`,
      };
      for (const [path, text] of Object.entries(files)) {
        mkdirSync(dirname(join(root, path)), { recursive: true });
        writeFileSync(join(root, path), text);
      }
      mkdirSync(join(root, "node_modules"));
      const installed = realpathSync(join(installJest(major), "node_modules/jest"));
      symlinkSync(installed, join(root, "node_modules/jest"));

      const resolution = resolveJest("unit", root, root);
      if (!resolution.ok) throw new Error(resolution.note);
      // Native Jest fails the 150 ms test under the root testTimeout: 25.
      const native = spawnSync(
        process.execPath,
        [
          resolution.install.bin,
          "--config",
          "jest.config.cjs",
          "--runInBand",
          "--ci",
          "--cacheDirectory",
          join(root, "..", `native-cache-${made++}`),
          "unit/slow.test.cjs",
        ],
        { cwd: root, encoding: "utf8", timeout: 120_000 },
      );
      expect(native.status).toBe(1);
      expect(`${native.stdout}\n${native.stderr}`).toMatch(/Exceeded timeout of 25 ms/);
      rmSync(join(root, "global-setup.ran"), { force: true });

      const unit = project("unit", "jest.config.cjs", "unit");
      const adapter = await createJestAdapter(unit, { root });
      const [environment] = await adapter.environment();
      expect(environment?.resolvedConfig).toContain(`"testTimeout":25`);
      expect(environment?.files).toContain("global-setup.cjs");
      const listed = await adapter.testFiles();
      expect(listed.map((f) => f.path)).toEqual(["unit/fast.test.cjs", "unit/slow.test.cjs"]);

      const report = await adapter.run(listed, {
        runId: `r2-global-${made}`,
        logDir: join(root, "..", `logs-${made++}`) as AbsolutePath,
        timeoutMs: 120_000,
      });
      expect(report.end).toBe("completed");
      expect(report.completedFiles).toEqual(listed);
      expect(report.fileErrors).toEqual([]);
      const byName = Object.fromEntries(report.results.map((r) => [r.check.fullName, r]));
      expect(byName["keeps inline globals without root globals"]?.outcome).toBe("pass");
      expect(byName["respects root timeout"]?.outcome).toBe("fail");
      expect(byName["respects root timeout"]?.errors[0]?.message).toMatch(
        /Exceeded timeout of 25 ms/,
      );
      expect(existsSync(join(root, "global-setup.ran"))).toBe(true);
      const fastLoaded = report.loaded?.find((l) => l.testFile.path === "unit/fast.test.cjs");
      expect(fastLoaded?.paths).toContain("unit/helper.cjs");
    },
  );
});
