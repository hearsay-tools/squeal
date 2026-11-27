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
// processes to it, though `--runInBand` runs several files in one process. Paths under
// `node_modules` are not kept: the installed-package fingerprint keys them.
//
// Row 028-08 (F1): Jest's own transform and resolver probe many absent files as a module loads
// (`babel.config.ts`, `<dir>/.babelrc`, `.browserslistrc`, `src/add.ts`, `src/package.json`),
// none the test's input, each first seen by a cold run's record, which then ran the file again.
// While a `ScriptTransformer` or `Resolver` method or Jest's ESM check runs, the mark is unset and what the call reads
// with success, `ts-jest`'s `.d.ts` reads among them, goes to
// `globalThis[Symbol.for("squeal.jestReads")]`, a `Map` of the test file to a `Set` of absolute
// paths, which the reporter takes as `loaded` is taken; with each file the transform got. A probe
// that finds nothing is kept by neither. The test's own code runs with the mark set.
//
// The project's own `jest-runtime`: `SQUEAL_JEST_RUNTIME` names its folder, since pnpm hoists
// none of Jest's packages. Without it, the one the running Jest reaches. CommonJS, Node
// built-ins only. A failure of its own is never the test's failure.
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const url = require("node:url");

const CURRENT_FILE = Symbol.for("squeal.currentTestFile");
const LOADED = Symbol.for("squeal.jestLoaded");
const READS = Symbol.for("squeal.jestReads");
/** Where a wrapped transformer or resolver keeps the test file it records for. */
const TARGET = Symbol("squeal.jestTarget");
/** Set on `fs` once its reads are wrapped. */
const WRAPPED = Symbol.for("squeal.jestReadsWrapped");
const NODE_MODULES = `${path.sep}node_modules${path.sep}`;
/** The `ScriptTransformer` methods every module source passes through, on Jest 29 and 30. */
const TRANSFORMS = ["transform", "transformAsync", "transformJson"];
/** The `Resolver` methods `jest-runtime` 29 and 30 call; each may probe absent files. */
const RESOLVES = [
  "resolveModuleFromDirIfExists",
  "resolveModuleFromDirIfExistsAsync",
  "resolveModule",
  "resolveModuleAsync",
  "resolveStubModuleName",
  "resolveStubModuleNameAsync",
  "getModule",
  "getModulePath",
  "getPackage",
  "getMockModule",
  "getMockModuleAsync",
  "getModulePaths",
  "getGlobalPaths",
  "getModuleID",
  "getModuleIDAsync",
];
/** `Runtime`'s constructor arguments, the same on Jest 29 and 30. */
const RESOLVER_ARG = 2;
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

/** The `Map` at `key` on `globalThis`, shared with the reporter in this process. */
function shared(key) {
  let map = globalThis[key];
  if (!(map instanceof Map)) {
    map = new Map();
    globalThis[key] = map;
  }
  return map;
}

/** The test files' loads. */
const loadedMap = () => shared(LOADED);
/** What Jest's transform and resolver read for each test file with the mark unset. */
const readsMap = () => shared(READS);

/** Adds `file` and its real path to `testPath`'s set in `map`, outside `node_modules`. */
function add(map, testPath, file) {
  try {
    if (typeof file !== "string" || !path.isAbsolute(file)) return;
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

/** Records `file` and its real path under `testPath`, outside `node_modules`. */
const record = (testPath, file) => add(loadedMap(), testPath, file);

/**
 * The pause of the mark: how many transform or resolver calls run, the mark they unset, and
 * the test file their successful reads go to. Process-wide, as the mark is.
 */
const pause = { depth: 0, saved: undefined, target: null };

/** The mark as the test's own code sees it: the saved one during a pause. */
const currentMark = () => (pause.depth > 0 ? pause.saved : globalThis[CURRENT_FILE]);

function setMark(value) {
  if (pause.depth > 0) pause.saved = value;
  else globalThis[CURRENT_FILE] = value;
}

/** Runs `call` with the mark unset and successful reads kept for `testPath`, sync or async. */
function paused(testPath, call) {
  if (pause.depth === 0) {
    pause.saved = globalThis[CURRENT_FILE];
    pause.target = testPath;
    globalThis[CURRENT_FILE] = undefined;
  }
  pause.depth += 1;
  let done = false;
  const leave = () => {
    if (done) return;
    done = true;
    pause.depth -= 1;
    if (pause.depth > 0) return;
    globalThis[CURRENT_FILE] = pause.saved;
    pause.saved = undefined;
    pause.target = null;
  };
  let result;
  try {
    result = call();
  } catch (error) {
    leave();
    throw error;
  }
  if (result !== null && typeof result === "object" && typeof result.then === "function") {
    return Promise.resolve(result).finally(leave);
  }
  leave();
  return result;
}

/** A path argument of a read as an absolute path; `null` for a descriptor or anything else. */
function readPath(p) {
  try {
    if (typeof p === "string") return path.resolve(p);
    if (Buffer.isBuffer(p)) return path.resolve(p.toString());
    if (p instanceof URL && p.protocol === "file:") return url.fileURLToPath(p);
  } catch {
    // not a path
  }
  return null;
}

/** Keeps a successful read of `p` for `target`, the test file of the pause it started in. */
function kept(target, p) {
  if (target === null) return;
  const abs = readPath(p);
  if (abs !== null) add(readsMap(), target, abs);
}

/** Replaces `object[name]` by `make(original)`, its descriptor otherwise kept. */
function replace(object, name, make) {
  const descriptor = Object.getOwnPropertyDescriptor(object, name);
  if (descriptor === undefined || typeof descriptor.value !== "function") return;
  Object.defineProperties(object, { [name]: { ...descriptor, value: make(descriptor.value) } });
}

/** Wraps `fs`'s file reads once: during a pause, each that succeeds is kept for its target. */
function wrapReads() {
  if (fs[WRAPPED] === true) return;
  Object.defineProperty(fs, WRAPPED, { value: true });
  replace(
    fs,
    "readFileSync",
    (original) =>
      function readFileSync(p, ...rest) {
        const result = original.call(this, p, ...rest);
        if (pause.depth > 0) kept(pause.target, p);
        return result;
      },
  );
  replace(
    fs,
    "readFile",
    (original) =>
      function readFile(p, ...rest) {
        const target = pause.depth > 0 ? pause.target : null;
        const last = rest.length - 1;
        if (target !== null && last >= 0 && typeof rest[last] === "function") {
          const callback = rest[last];
          rest[last] = function (err, ...data) {
            if (!err) kept(target, p);
            return callback.call(this, err, ...data);
          };
        }
        return original.call(this, p, ...rest);
      },
  );
  replace(
    fs.promises,
    "readFile",
    (original) =>
      function readFile(p, ...rest) {
        const target = pause.depth > 0 ? pause.target : null;
        const result = original.call(this, p, ...rest);
        if (target === null) return result;
        return result.then((data) => {
          kept(target, p);
          return data;
        });
      },
  );
}

/**
 * Points `object`'s methods `names` at `testPath`, each run by `wrap(holder, original)`. They
 * are wrapped once per instance; an instance reused for a later file then serves that file.
 */
function retarget(object, testPath, names, wrap) {
  if (object === null || typeof object !== "object") return;
  const target = object[TARGET];
  if (target !== undefined) {
    target.testPath = testPath;
    return;
  }
  const holder = { testPath };
  object[TARGET] = holder;
  for (const name of names) {
    const original = object[name];
    if (typeof original === "function") object[name] = wrap(holder, original);
  }
}

/** A transform: records the file, then transforms it with the mark paused. */
const transformHook = (holder, original) =>
  function (filename, ...rest) {
    record(holder.testPath, filename);
    if (typeof holder.testPath !== "string") return original.call(this, filename, ...rest);
    // The file Jest transforms is the test's input even when its transform cache answers.
    if (typeof filename === "string" && fs.existsSync(filename)) {
      add(readsMap(), holder.testPath, filename);
    }
    return paused(holder.testPath, () => original.call(this, filename, ...rest));
  };

/** A resolution: run with the mark paused. */
const resolveHook = (holder, original) =>
  function (...args) {
    if (typeof holder.testPath !== "string") return original.apply(this, args);
    return paused(holder.testPath, () => original.apply(this, args));
  };

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
      readsMap().set(testPath, new Set());
      wrapReads();
      retarget(args[TRANSFORMER_ARG], testPath, TRANSFORMS, transformHook);
      retarget(args[RESOLVER_ARG], testPath, RESOLVES, resolveHook);
    }
    super(...args);
    // Jest 30's per-runtime `Resolution` asks `jest-resolve`'s ESM check itself.
    if (observing) retarget(this._resolution, testPath, ["shouldLoadAsEsm"], resolveHook);
    this.__squealTestPath = observing ? testPath : null;
    this.__squealPrevious = currentMark();
    if (observing) setMark(testPath);
  }

  /**
   * Jest's ESM check, `jest-resolve`'s static `unstable_shouldLoadAsEsm` on Jest 29 and 30: with
   * `--experimental-vm-modules` it looks for `package.json` above each module, as resolution does.
   */
  unstable_shouldLoadAsEsm(...args) {
    const testPath = this.__squealTestPath;
    if (typeof testPath !== "string") return super.unstable_shouldLoadAsEsm(...args);
    return paused(testPath, () => super.unstable_shouldLoadAsEsm(...args));
  }

  teardown(...args) {
    try {
      return super.teardown(...args);
    } finally {
      if (this.__squealTestPath !== null) {
        flush(this.__squealTestPath);
        if (currentMark() === this.__squealTestPath) setMark(this.__squealPrevious);
        this.__squealTestPath = null;
      }
    }
  }
}

module.exports = SquealObservingRuntime;
