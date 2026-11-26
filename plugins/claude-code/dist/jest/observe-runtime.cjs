// Squeal's Jest `runtime` (spec 028 D3.1; research 028-01 F3.2). The wrapper config names
// this file as Jest's `runtime`, so Jest builds one instance per test file. Node's module hooks
// see no module a test loads inside Jest's VM sandbox; every CJS, ESM and JSON module source,
// manual mocks, setup files, `moduleNameMapper` targets and computed `require()` included,
// passes through the per-file `ScriptTransformer` instead. This class wraps that transformer
// and records each file it transforms, by its path and by its real path, so a pnpm workspace
// link records its `packages/...` target.
//
// Records go to `globalThis[Symbol.for("squeal.jestLoaded")]`, a `Map` from the test file's
// absolute path to a `Set` of absolute paths, which Squeal's reporter takes in
// `onTestFileResult` (row 028-03). With `SQUEAL_JEST_LOADED_OUT` set, each file's list is also
// appended at teardown to that file as a line `{"testPath":...,"loaded":[...]}`: a reporter in
// another process, or a test, reads it there.
//
// From construction to teardown, `globalThis[Symbol.for("squeal.currentTestFile")]` names the
// test file, so Squeal's recorder (`recorder.cjs`) attributes `fs` reads, listings and spawned
// processes to it, `ts-jest`'s `.d.ts` reads too, though `--runInBand` runs several files in
// one process. Paths under `node_modules` are not kept: the installed-package fingerprint keys
// them.
//
// The project's own `jest-runtime`: `SQUEAL_JEST_RUNTIME` names its folder, since pnpm hoists
// none of Jest's packages. Without it, the one the running Jest reaches. CommonJS, Node
// built-ins only. A failure of its own is never the test's failure.
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");

const CURRENT_FILE = Symbol.for("squeal.currentTestFile");
const LOADED = Symbol.for("squeal.jestLoaded");
/** Where a wrapped transformer keeps the test file it records for. */
const TARGET = Symbol("squeal.jestTarget");
const NODE_MODULES = `${path.sep}node_modules${path.sep}`;
/** The `ScriptTransformer` methods every module source passes through, on Jest 29 and 30. */
const TRANSFORMS = ["transform", "transformAsync", "transformJson"];
/** `Runtime`'s constructor arguments, the same on Jest 29 and 30. */
const TRANSFORMER_ARG = 3;
const TEST_PATH_ARG = 6;

/** The folder of `name` as the package in `from` resolves it, or null. */
function packageFrom(name, from) {
  try {
    return path.dirname(
      createRequire(path.join(from, "package.json")).resolve(`${name}/package.json`),
    );
  } catch {
    return null;
  }
}

/** The folder of the package holding `file`: the nearest one above it with a `package.json`. */
function packageOf(file) {
  let dir = path.dirname(fs.realpathSync(file));
  while (dir !== path.dirname(dir) && !fs.existsSync(path.join(dir, "package.json"))) {
    dir = path.dirname(dir);
  }
  return dir;
}

/**
 * Where `jest-runtime` is: `SQUEAL_JEST_RUNTIME`; else along the dependency links of the Jest
 * whose bin started this process, `jest` to `jest-cli` to `@jest/core` to `jest-runtime`, as
 * `resolve.ts` walks them; else as Node resolves it from the working directory.
 */
function runtimeFolder() {
  const named = process.env.SQUEAL_JEST_RUNTIME;
  if (typeof named === "string" && named !== "") return named;
  try {
    let dir = packageOf(require.main?.filename ?? "");
    for (const name of ["jest-cli", "@jest/core", "jest-runtime"]) {
      dir = dir === null ? null : packageFrom(name, dir);
    }
    if (dir !== null) return dir;
  } catch {
    // no main module, or one outside any package
  }
  return path.dirname(
    createRequire(path.join(process.cwd(), "noop.js")).resolve("jest-runtime/package.json"),
  );
}

const loaded = require(runtimeFolder());
const Runtime = loaded.default ?? loaded;

/** The test files' loads, shared with the reporter in this process. */
function loadedMap() {
  let map = globalThis[LOADED];
  if (!(map instanceof Map)) {
    map = new Map();
    globalThis[LOADED] = map;
  }
  return map;
}

/** Records `file` and its real path under `testPath`, outside `node_modules`. */
function record(testPath, file) {
  try {
    if (typeof file !== "string" || !path.isAbsolute(file)) return;
    const map = loadedMap();
    let paths = map.get(testPath);
    if (paths === undefined) {
      paths = new Set();
      map.set(testPath, paths);
    }
    if (!file.includes(NODE_MODULES)) paths.add(file);
    let real = file;
    try {
      real = fs.realpathSync.native(file);
    } catch {
      // a module Jest got from no file on disk
    }
    if (real !== file && !real.includes(NODE_MODULES)) paths.add(real);
  } catch {
    // never the test's failure
  }
}

/**
 * Points `transformer`'s source hooks at `testPath`. They are wrapped once per transformer, on
 * the instance; a transformer reused for a later file then records for that file alone.
 */
function observe(transformer, testPath) {
  if (transformer === null || typeof transformer !== "object") return;
  const target = transformer[TARGET];
  if (target !== undefined) {
    target.testPath = testPath;
    return;
  }
  const holder = { testPath };
  transformer[TARGET] = holder;
  for (const name of TRANSFORMS) {
    const original = transformer[name];
    if (typeof original !== "function") continue;
    transformer[name] = function (filename, ...rest) {
      record(holder.testPath, filename);
      return original.call(this, filename, ...rest);
    };
  }
}

/** Appends `testPath`'s loads to `SQUEAL_JEST_LOADED_OUT`, when set. */
function flush(testPath) {
  const out = process.env.SQUEAL_JEST_LOADED_OUT;
  if (typeof out !== "string" || out === "") return;
  try {
    const paths = loadedMap().get(testPath) ?? new Set();
    fs.appendFileSync(out, `${JSON.stringify({ testPath, loaded: [...paths].sort() })}\n`);
  } catch {
    // never the test's failure
  }
}

class SquealObservingRuntime extends Runtime {
  constructor(...args) {
    const testPath = args[TEST_PATH_ARG];
    const observing = typeof testPath === "string";
    // Before `super`: Jest 30 hands the transformer to helpers its constructor builds.
    if (observing) {
      loadedMap().set(testPath, new Set());
      observe(args[TRANSFORMER_ARG], testPath);
    }
    super(...args);
    this.__squealTestPath = observing ? testPath : null;
    this.__squealPrevious = globalThis[CURRENT_FILE];
    if (observing) globalThis[CURRENT_FILE] = testPath;
  }

  teardown(...args) {
    try {
      return super.teardown(...args);
    } finally {
      if (this.__squealTestPath !== null) {
        flush(this.__squealTestPath);
        if (globalThis[CURRENT_FILE] === this.__squealTestPath) {
          globalThis[CURRENT_FILE] = this.__squealPrevious;
        }
        this.__squealTestPath = null;
      }
    }
  }
}

module.exports = SquealObservingRuntime;
