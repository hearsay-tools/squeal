import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { AbsolutePath } from "../../../src/core/types/common.js";
import type { JestProject } from "../../../src/core/types/policy-jest.js";
import type { RunnerEnvironment } from "../../../src/core/types/runner.js";
import { createJestAdapter } from "../../../src/runners/jest/adapter.js";
import {
  JEST_UNAVAILABLE,
  jestEnvironment,
  readJestProject,
} from "../../../src/runners/jest/environment.js";
import { resolveJest } from "../../../src/runners/jest/resolve.js";
import { JEST_ADAPTER_VERSION } from "../../../src/runners/jest/version.js";
import { RECORDER_VERSION } from "../../../src/runners/observe/runtime.js";
import { installJest, JEST_MAJORS, type JestMajor } from "../../helpers/jest-env.js";

/*
 * Spec 028 D2.3: a Jest project's environment is the same in two worktrees
 * with the same files and packages, moves with its config, packages, env
 * and arguments, drops what changes per run, and is honestly unavailable
 * without a Jest to drive. Real Jest 29.7.0 and 30.5.2.
 */

const PROJECT: JestProject = {
  name: "app",
  config: "jest.config.js",
  include: [],
  exclude: [],
  args: [],
  env: {},
};
const SOURCE: NodeJS.ProcessEnv = { PATH: process.env.PATH, HOME: process.env.HOME };

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
  "tsconfig.json": `{ "extends": "./tsconfig.base.json" }\n`,
  "tsconfig.base.json": `{ "compilerOptions": { "strict": true } }\n`,
  "src/sum.js": "exports.sum = (a, b) => a + b;\n",
  "test/sum.test.js": `const { sum } = require("../src/sum");\ntest("adds", () => expect(sum(1, 2)).toBe(3));\n`,
};

const scratch = realpathSync(mkdtempSync(join(tmpdir(), "squeal-jest-environment-")));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));
let made = 0;

/** A worktree of `FILES` and `extra`, with the installed Jest linked in unless `jest` is false. */
function worktree(major: JestMajor, extra: Record<string, string> = {}, jest = true): AbsolutePath {
  const root = join(scratch, `tree-${made++}`);
  for (const [path, text] of Object.entries({ ...FILES, ...extra })) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  mkdirSync(join(root, "node_modules"), { recursive: true });
  if (jest) {
    const installed = realpathSync(join(installJest(major), "node_modules/jest"));
    symlinkSync(installed, join(root, "node_modules/jest"));
  }
  return root as AbsolutePath;
}

async function environmentOf(
  root: AbsolutePath,
  project: JestProject = PROJECT,
  source: NodeJS.ProcessEnv = SOURCE,
  observing = true,
): Promise<RunnerEnvironment> {
  const resolution = resolveJest(project.name, root, root);
  if (!resolution.ok) throw new Error(resolution.note);
  const read = await readJestProject(root, project, resolution.install, source);
  if (!read.ok) throw new Error(read.error);
  return jestEnvironment({
    root,
    project,
    install: resolution.install,
    read,
    source,
    adapterVersion: JEST_ADAPTER_VERSION,
    observing,
  });
}

const SLOW = { timeout: 240_000 };

describe.each(JEST_MAJORS)("the Jest %i environment (spec 028 D2.3)", (major) => {
  it("is the same in two worktrees at different paths", SLOW, async () => {
    const a = await environmentOf(worktree(major));
    const b = await environmentOf(worktree(major));
    expect(b).toEqual(a);
    expect(a.runnerVersion).toMatch(new RegExp(`^${major}\\.`));
    expect(a.resolvedConfig).not.toContain(scratch);
    expect(a.resolvedConfig).toContain("<worktree>/setup/env.js");
    expect(a.observedLoads).toBe(true);
  });

  it(
    "watches the config chain: config, setup file, package.json, tsconfig and its extends",
    SLOW,
    async () => {
      const env = await environmentOf(worktree(major));
      expect(env.files).toEqual(
        expect.arrayContaining([
          "jest.config.js",
          "setup/env.js",
          "package.json",
          "tsconfig.json",
          "tsconfig.base.json",
          "babel.config.js",
          ".babelrc",
        ]),
      );
      expect(env.files.some((f) => f.includes("node_modules"))).toBe(false);
    },
  );

  it("drops what changes per run: cache directory, workers, seed", SLOW, async () => {
    const plain = await environmentOf(worktree(major));
    const volatile = await environmentOf(
      worktree(major, {
        "jest.config.js": CONFIG(`\n  cacheDirectory: "/tmp/elsewhere", maxWorkers: 3, seed: 7,`),
      }),
    );
    expect(volatile.resolvedConfig).toBe(plain.resolvedConfig);
    for (const key of ['"cacheDirectory"', '"maxWorkers"', '"seed"', '"id"']) {
      expect(plain.resolvedConfig).not.toContain(key);
    }
  });

  it(
    "moves with the config, a package version, the args, the env and the recorder",
    SLOW,
    async () => {
      const root = worktree(major);
      const base = (await environmentOf(root)).resolvedConfig;
      const typescript = `{ "name": "typescript", "version": "5.9.0" }\n`;
      const changed = [
        await environmentOf(
          worktree(major, { "jest.config.js": CONFIG("\n  testTimeout: 9000,") }),
        ),
        await environmentOf(
          worktree(major, { "node_modules/typescript/package.json": typescript }),
        ),
        await environmentOf(root, { ...PROJECT, args: ["--silent"] }),
        await environmentOf(root, { ...PROJECT, env: { DB: "db-{worktreeSlot}" } }),
        await environmentOf(root, PROJECT, { ...SOURCE, TZ: "Asia/Tokyo" }),
        await environmentOf(root, PROJECT, { ...SOURCE, NODE_ENV: "production" }),
        await environmentOf(root, PROJECT, SOURCE, false),
      ].map((e) => e.resolvedConfig);
      for (const config of changed) expect(config).not.toBe(base);
      expect(new Set(changed).size).toBe(changed.length);
      // Unexpanded: the template keys as written, never one slot's value.
      expect(changed[3]).toContain("db-{worktreeSlot}");
      expect(base).toContain(`"recorder":"${RECORDER_VERSION}"`);
      expect(base).toContain(`"NODE_ENV":"test"`);
    },
  );

  it(
    "is unavailable, with no test files and crashed runs, when the worktree has no Jest",
    SLOW,
    async () => {
      const notes: string[] = [];
      const root = worktree(major, {}, false);
      const adapter = await createJestAdapter(PROJECT, { root, note: (text) => notes.push(text) });
      const [env] = await adapter.environment();
      expect(env?.runnerVersion).toBe(JEST_UNAVAILABLE);
      expect(env?.resolvedConfig).toContain('"state":"unavailable"');
      expect(await adapter.testFiles()).toEqual([]);
      expect(notes).toEqual([expect.stringMatching(/^jest project "app": .*no jest package/)]);
      const report = await adapter.run([{ project: "app", path: "test/sum.test.js" }], {
        runId: "r",
        logDir: join(root, ".logs") as AbsolutePath,
        timeoutMs: 60_000,
      });
      expect(report).toMatchObject({ end: "crashed", completedFiles: [] });
      expect(report.failure).toMatch(/no jest package/);
    },
  );

  it("is unavailable for a Jest outside 29 and 30", SLOW, async () => {
    const old = `{ "name": "jest", "version": "28.1.3", "bin": "bin/jest.js" }\n`;
    const root = worktree(major, { "node_modules/jest/package.json": old }, false);
    const adapter = await createJestAdapter(PROJECT, { root });
    const [env] = await adapter.environment();
    expect(env?.runnerVersion).toBe(JEST_UNAVAILABLE);
    expect(env?.resolvedConfig).toMatch(/28\.1\.3.*outside the supported/);
  });
});

/*
 * Review 0.1.644 B4: every worktree file the config evaluation loads or
 * reads is in the chain, on a read that fails too; test files and installed
 * packages are not.
 */
describe.each(JEST_MAJORS)("the Jest %i config's imported files (B4)", (major) => {
  const IMPORTING = `const { timeout } = require("./config/options.cjs");
const fs = require("fs");
const extra = JSON.parse(fs.readFileSync(require("path").join(__dirname, "config/extra.json"), "utf8"));
module.exports = {
  testEnvironment: "node",
  testMatch: ["<rootDir>/test/**/*.test.js"],
  testTimeout: timeout,
  ...extra,
};
`;
  const HELPERS = {
    "jest.config.js": IMPORTING,
    "config/options.cjs": `module.exports = { timeout: 1000 };\n`,
    "config/extra.json": `{ "bail": 1 }\n`,
  };

  it("keys and watches modules and data files the config loads", SLOW, async () => {
    const root = worktree(major, HELPERS);
    const env = await environmentOf(root);
    expect(env.files).toEqual(
      expect.arrayContaining(["jest.config.js", "config/options.cjs", "config/extra.json"]),
    );
    expect(env.files).not.toContain("test/sum.test.js");
    expect(env.files).not.toContain("src/sum.js");
    expect(env.files.some((f) => f.includes("node_modules"))).toBe(false);
    // The same in another worktree: the files are worktree-relative.
    expect(await environmentOf(worktree(major, HELPERS))).toEqual(env);
  });

  it("follows an ESM import from a config module", SLOW, async () => {
    const root = worktree(major, {
      "jest.config.mjs": `import options from "./config/options.mjs";
export default { testEnvironment: "node", testMatch: ["<rootDir>/test/**/*.test.js"], ...options };
`,
      "config/options.mjs": `export default { testTimeout: 1000 };\n`,
    });
    const env = await environmentOf(root, { ...PROJECT, config: "jest.config.mjs" });
    expect(env.files).toEqual(expect.arrayContaining(["jest.config.mjs", "config/options.mjs"]));
  });

  it("keeps the helpers a failed read loaded", SLOW, async () => {
    const root = worktree(major, {
      ...HELPERS,
      "config/options.cjs": `require("./deeper.cjs");\nthrow new Error("broken helper");\n`,
      "config/deeper.cjs": `module.exports = {};\n`,
    });
    const resolution = resolveJest(PROJECT.name, root, root);
    if (!resolution.ok) throw new Error(resolution.note);
    const read = await readJestProject(root, PROJECT, resolution.install, SOURCE);
    expect(read).toMatchObject({ ok: false, error: expect.stringContaining("broken helper") });
    const env = jestEnvironment({
      root,
      project: PROJECT,
      install: resolution.install,
      read,
      source: SOURCE,
      adapterVersion: JEST_ADAPTER_VERSION,
      observing: true,
    });
    expect(env.files).toEqual(
      expect.arrayContaining(["jest.config.js", "config/options.cjs", "config/deeper.cjs"]),
    );
  });

  /** The child's read of `root`'s project. */
  async function readOf(root: AbsolutePath, project: JestProject = PROJECT) {
    const resolution = resolveJest(project.name, root, root);
    if (!resolution.ok) throw new Error(resolution.note);
    return readJestProject(root, project, resolution.install, SOURCE);
  }
  const deps = (root: AbsolutePath, read: { configDeps?: readonly string[] }) =>
    (read.configDeps ?? []).map((path) => path.slice(root.length + 1));

  // Review 0.1.644-r2 B4: creating what was missing reads the config again.
  it("names the missing helper a failed require, read or import asked for", SLOW, async () => {
    const required = worktree(major, { ...HELPERS, "config/options.cjs": "" });
    rmSync(join(required, "config/options.cjs"));
    const noRequire = await readOf(required);
    expect(noRequire.ok).toBe(false);
    expect(deps(required, noRequire)).toEqual(expect.arrayContaining(["config/options.cjs"]));

    const readMissing = worktree(major, HELPERS);
    rmSync(join(readMissing, "config/extra.json"));
    const noRead = await readOf(readMissing);
    expect(noRead.ok).toBe(false);
    expect(deps(readMissing, noRead)).toEqual(
      expect.arrayContaining(["jest.config.js", "config/options.cjs", "config/extra.json"]),
    );

    const esm = worktree(major, {
      "jest.config.mjs": `import options from "./config/options.mjs";
export default { testEnvironment: "node", testMatch: ["<rootDir>/test/**/*.test.js"], ...options };
`,
    });
    const noImport = await readOf(esm, { ...PROJECT, config: "jest.config.mjs" });
    expect(noImport.ok).toBe(false);
    expect(deps(esm, noImport)).toEqual(expect.arrayContaining(["config/options.mjs"]));
  });

  it("keys no missing file a healthy read only probed", SLOW, async () => {
    const root = worktree(major, {
      "jest.config.js": `let extra = {};
try { extra = require("./config/maybe.cjs"); } catch {}
try { extra = JSON.parse(require("fs").readFileSync("./config/maybe.json", "utf8")); } catch {}
module.exports = { testEnvironment: "node", testMatch: ["<rootDir>/test/**/*.test.js"], ...extra };
`,
    });
    const read = await readOf(root);
    expect(read.ok).toBe(true);
    expect(deps(root, read).filter((path) => path.startsWith("config/"))).toEqual([]);
    const env = await environmentOf(root);
    expect(env.files.filter((path) => path.startsWith("config/"))).toEqual([]);
  });
});
