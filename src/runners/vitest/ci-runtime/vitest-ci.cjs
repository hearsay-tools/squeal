// `squeal ci record`'s hook in the project's own Vitest (spec 018 D8, row
// 018-16). Loaded through `NODE_OPTIONS` beside the recorder, in every process
// the command starts; it acts only in a Vitest CLI process (its main script is
// the `bin` of the `vitest` package), on the main thread. There it wraps
// `Vitest.prototype.start`, which the CLI calls for each run after the
// instance built its own reporters, and adds one reporter to the instance
// before the run starts, so the run's own reporters, config and exit code stay
// as they are. Vitest 4.1 and 5 export the `Vitest` class only as a type;
// `vitest/node` imports it from one of its own modules for its `version`, so
// the hook looks there (row 018-26: Vitest 4.1 has no `Logger.setVitest`).
//
// The reporter keeps what each test module ended with and, at the end of the
// run, writes one JSON file per process into the private directory the
// settings name: the run's outcomes, its shard, its projects' serialized
// configs and the variables the settings name. `squeal ci record` reads it, turns it into a
// part and removes it; config and variable values never reach the part.
// Spec 020 D13 (row 020-08a): before the original `start`, the wrap adds
// Squeal's coverage provider (`coverage.cjs`); the file then holds whether
// it did, and each module's coverage record or why it has none. D19.6
// (review of 0.1.443 B1): when a provider ran, it also names the test files
// whose workers loaded `node:inspector` (`inspector.cjs`).
//
// In every process and thread of the command, first, it starts the watch of
// `node:inspector` loads (`inspector.cjs`), except in a Vitest CLI process,
// where no test file runs (review of 0.1.444 S1), and in the test workers of
// a Vitest process in which no coverage provider runs: the `start` wrap tells
// them so (`watchWorkers`, review of 0.1.443-r2 S2). Then it takes the input
// evidence (`evidence-hooks.cjs`; spec 018 D9 as amended 2026-11-09) when the
// settings name its directory, so Vitest and what it loads see the wrapped
// `fs` from their start.
//
// Settings, `SQUEAL_CI_RECORD`, JSON: `raw` the directory, `variables` the
// names whose values the file keeps, `evidence` the evidence's settings
// (`out`, `root`, `skip`, `format`), `coverage` the provider's
// (`coverage.cjs`), `nested` when a Vitest run or one of its test workers
// started this process. Such a run is a test's own, not the project's: it
// takes the evidence and writes no file (row 018-27). Every child of a Vitest
// CLI process gets `nested` (`children.cjs`). Before it can attach, the hook
// writes the file with `state: "started"`, so a Vitest process that ends
// without a run end is known. CommonJS with Node built-ins only; `require` of the project's
// `vitest/node` (an ES module without top-level await) is synchronous, so the
// wrap is in place before the CLI starts its run. Any error of its own is
// written to the file as `failed`, never thrown into the run.
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const { isMainThread } = require("node:worker_threads");
const clock = require("./clock.cjs");
const { coveredModules, coveredReporter, startCoverage } = require("./coverage.cjs");
const { installWatch, watchWorkers } = require("./inspector.cjs");

const VARIABLE = "SQUEAL_CI_RECORD";
const REGEXP = "squeal:regexp";

function readSettings() {
  try {
    const value = JSON.parse(process.env[VARIABLE] ?? "");
    if (typeof value.raw !== "string") return null;
    const variables = Array.isArray(value.variables)
      ? value.variables.filter((v) => typeof v === "string")
      : [];
    const coverage = typeof value.coverage === "object" ? value.coverage : null;
    return { raw: value.raw, variables, nested: value.nested === true, coverage };
  } catch {
    return null;
  }
}

/** Whether `main` may be the `bin` of the `vitest` package: its name says so; no test worker's does. */
const vitestScript = (main) => typeof main === "string" && path.basename(main).startsWith("vitest");

/** The `vitest` package whose `bin` this process runs, or `null`. */
function vitestPackage(main) {
  if (!vitestScript(main)) return null;
  const file = fs.realpathSync(main);
  const found = nearestManifest(path.dirname(file));
  if (found === null || found.manifest.name !== "vitest") return null;
  const { bin } = found.manifest;
  const own = typeof bin === "string" ? bin : bin?.vitest;
  return typeof own === "string" && path.resolve(found.dir, own) === file ? found.dir : null;
}

/** The nearest `package.json` at or above `start` that parses, and its directory. */
function nearestManifest(start) {
  for (let dir = start; dir !== path.dirname(dir); dir = path.dirname(dir)) {
    try {
      return { dir, manifest: JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")) };
    } catch {}
  }
  return null;
}

function writeRaw(file, value) {
  const replacer = (_key, item) => (item instanceof RegExp ? { [REGEXP]: String(item) } : item);
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(value, replacer), { mode: 0o600 });
  fs.renameSync(`${file}.tmp`, file);
}

function diagnosticOf(module) {
  const d = module.diagnostic();
  return {
    environmentSetupDuration: d.environmentSetupDuration,
    prepareDuration: d.prepareDuration,
    collectDuration: d.collectDuration,
    setupDuration: d.setupDuration,
    duration: d.duration,
  };
}

function moduleOf(module) {
  let errors = module.errors().length;
  for (const suite of module.children.allSuites()) errors += suite.errors().length;
  const tests = [...module.children.allTests()].map((test) => ({
    id: test.id,
    fullName: test.fullName,
    location: test.location ? { line: test.location.line, column: test.location.column } : null,
    state: test.result().state,
    durationMs: test.diagnostic()?.duration ?? 0,
  }));
  return {
    project: module.project.name,
    moduleId: module.moduleId,
    state: module.state(),
    diagnostic: diagnosticOf(module),
    errors,
    tests,
  };
}

function projectOf(project) {
  const globalSetup = project.config.globalSetup;
  return {
    name: project.name,
    config: project.serializedConfig,
    globalSetup: typeof globalSetup === "string" ? [globalSetup] : [...(globalSetup ?? [])],
  };
}

function reporterFor(vitest, file, settings, fail, modules) {
  // A reporter that throws fails the run: every error goes to the file instead.
  // Its time is Squeal's (`clock.cjs`, row 018-29).
  const safe = (fn) =>
    clock.timed((...args) => {
      try {
        fn(...args);
      } catch (error) {
        fail(error);
      }
    });
  return {
    onTestModuleEnd: safe((module) => {
      modules.set(`${module.project.name}\0${module.moduleId}`, moduleOf(module));
    }),
    // `covered`: the coverage `coveredReporter` waited for (spec 020 D13).
    onTestRunEnd: safe((_modules, unhandledErrors, reason, covered) => {
      const env = {};
      for (const name of settings.variables) {
        if (process.env[name] !== undefined) env[name] = process.env[name];
      }
      const shard = vitest.config?.shard;
      writeRaw(file, {
        state: "ended",
        vitest: vitest.version,
        shard: shard ? { index: shard.index, count: shard.count } : null,
        node: { version: process.version, platform: process.platform, arch: process.arch },
        reason,
        unhandled: unhandledErrors.map((error) =>
          typeof error?.VITEST_TEST_PATH === "string" ? error.VITEST_TEST_PATH : null,
        ),
        projects: vitest.projects.map(projectOf),
        modules: coveredModules(modules, covered),
        coverage: covered.header,
        env,
      });
    }),
  };
}

function install(settings, root) {
  const file = path.join(settings.raw, `${process.pid}.json`);
  writeRaw(file, { state: "started" });
  const fail = (error) => {
    try {
      writeRaw(file, { state: "failed", reason: String(error?.message ?? error) });
    } catch {}
  };
  try {
    const Vitest = vitestClass(createRequire(path.join(root, "package.json")));
    if (Vitest === null) throw new Error("vitest/node imports no Vitest class with start");
    const original = Vitest.prototype.start;
    const reporters = new WeakMap();
    Vitest.prototype.start = function start(...args) {
      try {
        // Again at each start: a restart builds the instance's reporters anew.
        if (!Array.isArray(this.reporters)) throw new Error("the Vitest instance has no reporters");
        if (!reporters.has(this)) {
          // Spec 020 D13: before the original `start`, which starts the coverage provider.
          const coverage = startCoverage(this, settings.coverage);
          // Review of 0.1.443-r2 S2: before the run starts its workers.
          watchWorkers(settings.raw, providerRuns(this));
          const modules = new Map();
          const reporter = reporterFor(this, file, settings, fail, modules);
          reporters.set(this, coveredReporter(reporter, coverage, modules, settings.raw));
        }
        const reporter = reporters.get(this);
        if (!this.reporters.includes(reporter)) this.reporters.push(reporter);
      } catch (error) {
        fail(error);
      }
      return original.apply(this, args);
    };
  } catch (error) {
    fail(error);
  }
}

/**
 * Whether a coverage provider runs in `vitest`'s runs: the project's, or
 * Squeal's, which `startCoverage` put in `configOverride`. When that does
 * not read, one may.
 */
function providerRuns(vitest) {
  try {
    return (
      vitest.config?.coverage?.enabled === true || vitest.configOverride?.coverage?.enabled === true
    );
  } catch {
    return true;
  }
}

/**
 * The project's `Vitest` class, or `null`: an export of `vitest/node` or of a
 * module it imports by a relative path, whose static `version` is
 * `vitest/node`'s and whose prototype has `start`. Those modules are loaded
 * already, so `require` only returns them; one that does not load is passed
 * over.
 */
function vitestClass(load) {
  const file = load.resolve("vitest/node");
  const node = load(file);
  if (typeof node.version !== "string") return null;
  const modules = [node];
  const source = fs.readFileSync(file, "utf8");
  for (const [, specifier] of source.matchAll(/\bfrom\s*["'](\.\.?\/[^"']+)["']/g)) {
    try {
      modules.push(load(path.resolve(path.dirname(file), specifier)));
    } catch {}
  }
  for (const module of modules) {
    for (const value of Object.values(module)) {
      if (
        typeof value === "function" &&
        value.version === node.version &&
        typeof value.prototype?.start === "function"
      ) {
        return value;
      }
    }
  }
  return null;
}

/** The evidence's settings in `SQUEAL_CI_RECORD`, or `null`. */
function readEvidence() {
  try {
    const value = JSON.parse(process.env[VARIABLE] ?? "")?.evidence;
    if (typeof value?.out !== "string" || typeof value.root !== "string") return null;
    const skip = Array.isArray(value.skip) ? value.skip.filter((s) => typeof s === "string") : [];
    return { out: value.out, root: value.root, skip, format: value.format };
  } catch {
    return null;
  }
}

const settings = readSettings();

// Spec 020 D19.6 (review of 0.1.443 B1): the test files that load `node:inspector`, before the evidence.
// Not in a Vitest CLI process (review of 0.1.444 S1): known by name only, as no file is read before the evidence.
try {
  if (!(isMainThread && vitestScript(process.argv[1]))) {
    installWatch(settings?.raw, settings?.coverage?.provider);
  }
} catch {}

try {
  require("./evidence-hooks.cjs").installEvidence(readEvidence());
} catch {}

if (settings !== null && isMainThread && !globalThis.__squealCiRecord) {
  globalThis.__squealCiRecord = true;
  try {
    const root = vitestPackage(process.argv[1]);
    if (root !== null) {
      require("./children.cjs").markNested();
      if (!settings.nested) install(settings, root);
    }
  } catch {}
}
