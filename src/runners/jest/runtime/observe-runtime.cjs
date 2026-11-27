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
// While a `ScriptTransformer` or `Resolver` method or Jest's ESM check runs, the mark is unset
// and what the call reads with success, `ts-jest`'s `.d.ts` reads among them, by path, descriptor,
// FileHandle or stream (review 0.1.653 B2), goes to `globalThis[Symbol.for("squeal.jestReads")]`,
// a `Map` of the test file to a `Set` of absolute paths, which the reporter takes as `loaded` is
// taken; with each file the transform got. A probe that finds nothing is kept by neither. The
// pause is the call's async context (B3): the test's own code runs with the mark set, while an
// async transform waits too.
//
// The project's own `jest-runtime`: `SQUEAL_JEST_RUNTIME` names its folder, since pnpm hoists
// none of Jest's packages. Without it, the one the running Jest reaches. CommonJS, Node
// built-ins only. A failure of its own is never the test's failure.
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { AsyncLocalStorage } = require("node:async_hooks");
const { createRequire } = require("node:module");
const url = require("node:url");

const CURRENT_FILE = Symbol.for("squeal.currentTestFile");
const LOADED = Symbol.for("squeal.jestLoaded");
const READS = Symbol.for("squeal.jestReads");
/** Where a wrapped transformer or resolver keeps the test file it records for. */
const TARGET = Symbol("squeal.jestTarget");
/** The pause of the mark, once per process (review 0.1.653 B3). */
const PAUSE = Symbol.for("squeal.jestPauseState");
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
 * Review 0.1.653 B3: the pause of the mark belongs to the async context of the transform or
 * resolver call, not to the process. The mark becomes an accessor on `globalThis`: inside a
 * call `paused` runs, and every continuation it starts, it reads `undefined`; the test's own
 * code, a continuation that runs while an async transform waits among it, reads the test file.
 * Installed once per process; `state.mark` is the mark as the test's own code sees it.
 */
function pauseState() {
  const existing = globalThis[PAUSE];
  if (existing !== undefined) return existing;
  const state = { store: new AsyncLocalStorage(), mark: globalThis[CURRENT_FILE] };
  Object.defineProperty(globalThis, PAUSE, { value: state, configurable: true });
  Object.defineProperty(globalThis, CURRENT_FILE, {
    configurable: true,
    enumerable: false,
    get() {
      return state.store.getStore() !== undefined ? undefined : state.mark;
    },
    set(value) {
      state.mark = value;
    },
  });
  return state;
}

const state = pauseState();

/** The mark as the test's own code sees it, inside a pause too. */
const currentMark = () => state.mark;

function setMark(value) {
  state.mark = value;
}

/** Runs `call` with the mark unset and successful reads kept for `testPath`, sync or async. */
const paused = (testPath, call) => state.store.run(testPath, call);

/** The test file the current pause keeps reads for; `null` outside a pause. */
const pausedFor = () => state.store.getStore() ?? null;

/** Descriptors and FileHandles opened on a path, so a read through one names its file (B2). */
const fds = new Map();
const handles = new WeakMap();

/** A read's target as an absolute path: a path, a descriptor or a FileHandle; else `null`. */
function readPath(p) {
  try {
    if (typeof p === "number") return fds.get(p) ?? null;
    if (typeof p === "string") return path.resolve(p);
    if (Buffer.isBuffer(p)) return path.resolve(p.toString());
    if (p instanceof URL) return p.protocol === "file:" ? url.fileURLToPath(p) : null;
    if (p !== null && typeof p === "object") return handles.get(p) ?? null;
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

const { O_WRONLY } = fs.constants;
const O_ACCMODE = 3;

/** Whether an open with `flags` can read, as `recorder.cjs`'s `fs` wrappers classify it. */
function readable(flags) {
  if (flags == null || typeof flags === "function") return true;
  if (typeof flags === "number") return (flags & O_ACCMODE) !== O_WRONLY;
  return typeof flags === "string" && /[r+]/.test(flags);
}

/** Names `opened`, a descriptor or a FileHandle, by `p`; a readable open in a pause is kept. */
function track(opened, p, flags, target) {
  try {
    const abs = readPath(p);
    if (abs === null) return;
    if (typeof opened === "number") fds.set(opened, abs);
    else if (opened !== null && typeof opened === "object") handles.set(opened, abs);
    else return;
    if (target !== null && readable(flags)) add(readsMap(), target, abs);
  } catch {
    // never the test's failure
  }
}

/**
 * Replaces `object[name]` by `make(original)`: its descriptor and the original's own
 * properties (`util.promisify.custom`, Node's promisify arguments) kept.
 */
function replace(object, name, make) {
  const descriptor = object == null ? undefined : Object.getOwnPropertyDescriptor(object, name);
  if (descriptor === undefined || typeof descriptor.value !== "function") return;
  const wrapped = make(descriptor.value);
  Object.defineProperties(wrapped, Object.getOwnPropertyDescriptors(descriptor.value));
  Object.defineProperties(object, { [name]: { ...descriptor, value: wrapped } });
}

/** `rest` with its callback, the last argument, wrapped by `wrap`; unchanged without one. */
function withCallback(rest, wrap) {
  const last = rest.length - 1;
  if (last >= 0 && typeof rest[last] === "function") rest[last] = wrap(rest[last]);
  return rest;
}

/** A read's call: kept for the pause it started in when it succeeds, by path or descriptor. */
const syncRead = (original) =>
  function (p, ...rest) {
    const result = original.call(this, p, ...rest);
    kept(pausedFor(), p);
    return result;
  };

const callbackRead = (original) =>
  function (p, ...rest) {
    const target = pausedFor();
    if (target === null) return original.call(this, p, ...rest);
    const args = withCallback(
      rest,
      (callback) =>
        function (err, ...data) {
          if (!err) kept(target, p);
          return callback.call(this, err, ...data);
        },
    );
    return original.call(this, p, ...args);
  };

const promiseRead = (original) =>
  function (p, ...rest) {
    const target = pausedFor();
    const result = original.call(this, p, ...rest);
    if (target === null) return result;
    return result.then((data) => {
      kept(target, p);
      return data;
    });
  };

/** A close forgets its descriptor, so a reused number names no earlier file. */
const forget = (original) =>
  function (fd, ...rest) {
    if (typeof fd === "number") fds.delete(fd);
    return original.call(this, fd, ...rest);
  };

/**
 * Wraps `fs`'s reads once: during a pause, each that succeeds is kept for its target, by path,
 * descriptor (`openSync`, `open`, `readSync`, `read`), FileHandle (`promises.open`, its `read`
 * and `readFile`) or stream (`createReadStream`, once it opens). A probe that finds nothing
 * keeps nothing.
 */
function wrapReads() {
  if (fs[WRAPPED] === true) return;
  Object.defineProperty(fs, WRAPPED, { value: true });
  for (const name of ["readFileSync", "readSync"]) replace(fs, name, syncRead);
  for (const name of ["readFile", "read"]) replace(fs, name, callbackRead);
  replace(fs.promises, "readFile", promiseRead);
  for (const name of ["closeSync", "close"]) replace(fs, name, forget);
  replace(
    fs,
    "openSync",
    (original) =>
      function (p, ...rest) {
        const fd = original.call(this, p, ...rest);
        track(fd, p, rest[0], pausedFor());
        return fd;
      },
  );
  replace(
    fs,
    "open",
    (original) =>
      function (p, ...rest) {
        const target = pausedFor();
        const flags = rest.length >= 2 ? rest[0] : undefined;
        const args = withCallback(
          rest,
          (callback) =>
            function (err, fd, ...more) {
              if (!err) track(fd, p, flags, target);
              return callback.call(this, err, fd, ...more);
            },
        );
        return original.call(this, p, ...args);
      },
  );
  let handlesWrapped = false;
  replace(
    fs.promises,
    "open",
    (original) =>
      function (p, ...rest) {
        const target = pausedFor();
        return original.call(this, p, ...rest).then((handle) => {
          track(handle, p, rest[0], target);
          if (!handlesWrapped && handle !== null && typeof handle === "object") {
            handlesWrapped = true;
            const proto = Object.getPrototypeOf(handle);
            for (const name of ["readFile", "read"]) {
              replace(
                proto,
                name,
                (read) =>
                  function (...args) {
                    const at = pausedFor();
                    const result = read.apply(this, args);
                    if (at === null) return result;
                    return result.then((data) => {
                      kept(at, this);
                      return data;
                    });
                  },
              );
            }
          }
          return handle;
        });
      },
  );
  replace(
    fs,
    "createReadStream",
    (original) =>
      function (p, ...rest) {
        const target = pausedFor();
        const stream = original.call(this, p, ...rest);
        if (target === null || typeof stream?.once !== "function") return stream;
        // A stream given an open descriptor or FileHandle reads it; one given a path, once open.
        const fd = rest[0] !== null && typeof rest[0] === "object" ? rest[0].fd : undefined;
        if (fd != null) kept(target, fd);
        else stream.once("open", () => kept(target, p));
        return stream;
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
