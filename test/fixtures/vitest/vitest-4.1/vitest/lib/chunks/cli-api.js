// The parts of Vitest 4.1.10's `cli-api` chunk that `squeal ci record`'s hook
// meets (row 018-26): a `Vitest` class with a static `version`, `reporters`
// built in `_setServer`, `onAfterSetServer`, `report` and `start`. A test file
// here exports a default object: each key a test name, each value a function
// that passes unless it throws, or "skip".
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const VERSION = "4.1.10";

/** The run's own reporter: one line per test file, as Vitest's default reporter prints. */
const ownReporter = {
  onTestModuleEnd(module) {
    process.stdout.write(`${module.state()} ${module.moduleId}\n`);
  },
};

class Vitest {
  static version = VERSION;
  version = VERSION;
  projects = [];
  reporters = [];
  _onSetServer = [];
  constructor(mode, cliOptions) {
    this.mode = mode;
    this._cliOptions = cliOptions;
  }
  get config() {
    return this._config;
  }
  async _setServer() {
    const root = process.cwd();
    this._config = { root, shard: undefined };
    this.projects = [project(root)];
    this.reporters = [ownReporter];
    await Promise.all(this._onSetServer.map((fn) => fn()));
  }
  onAfterSetServer(fn) {
    this._onSetServer.push(fn);
  }
  async report(name, ...args) {
    await Promise.all(this.reporters.map((r) => r[name]?.(...args)));
  }
  async start(filters) {
    await this.report("onInit", this);
    const dir = join(this.config.root, "test");
    const files = readdirSync(dir)
      .filter((name) => name.endsWith(".test.js"))
      .filter((name) => filters.length === 0 || filters.some((f) => name.includes(f)))
      .sort();
    const modules = [];
    for (const name of files) {
      const module = await runModule(this.projects[0], join(dir, name));
      modules.push(module);
      await this.report("onTestModuleEnd", module);
    }
    const failed = modules.some((module) => module.state() === "failed");
    if (failed) process.exitCode = 1;
    await this.report("onTestRunEnd", modules, [], failed ? "failed" : "passed");
  }
  async close() {}
}

function project(root) {
  return {
    name: "",
    config: { globalSetup: [] },
    serializedConfig: {
      root,
      allowOnly: false,
      sequence: {},
      coverage: {},
      snapshotOptions: { updateSnapshot: "none" },
    },
  };
}

async function runModule(project, moduleId) {
  const started = performance.now();
  const { default: cases } = await import(pathToFileURL(moduleId).href);
  const tests = Object.entries(cases).map(([name, body], index) => {
    const begun = performance.now();
    let state = "skipped";
    if (body !== "skip") {
      try {
        body();
        state = "passed";
      } catch {
        state = "failed";
      }
    }
    const duration = performance.now() - begun;
    return {
      id: `${moduleId}_${index}`,
      fullName: name,
      location: { line: index + 2, column: 3 },
      result: () => ({ state }),
      diagnostic: () => ({ duration }),
    };
  });
  const states = tests.map((test) => test.result().state);
  const state = states.includes("failed")
    ? "failed"
    : states.every((s) => s === "skipped")
      ? "skipped"
      : "passed";
  const duration = performance.now() - started;
  return {
    type: "module",
    project,
    moduleId,
    state: () => state,
    errors: () => [],
    diagnostic: () => ({
      environmentSetupDuration: 0,
      prepareDuration: 0,
      collectDuration: 0,
      setupDuration: 0,
      duration,
    }),
    children: {
      *allSuites() {},
      *allTests() {
        yield* tests;
      },
    },
  };
}

async function createVitest(mode, options) {
  const ctx = new Vitest(mode, options);
  await ctx._setServer();
  return ctx;
}

async function startVitest(mode, filters = [], options = {}) {
  const ctx = await createVitest(mode, options);
  await ctx.start(filters);
  await ctx.close();
  return ctx;
}

export { Vitest as V, createVitest as c, startVitest as s };
