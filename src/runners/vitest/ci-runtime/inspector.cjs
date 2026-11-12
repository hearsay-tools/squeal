// Spec 020 D13.4 and D19.6 (review of 0.1.443 B1, row 020-26ab R1): which
// test files loaded `node:inspector`, seen in the test workers themselves,
// apart from any coverage payload or record. `ci export` leaves such a file
// out whenever a coverage provider ran, the project's or Squeal's, also
// when `ci record` yielded to the project's provider and mapped nothing.
//
// `installWatch` runs in every process and thread of the recorded command,
// before the evidence hooks. In a Vitest worker it attributes each load to
// the test file running then (`__vitest_worker__.filepath`, as Squeal's
// runtime recorder does): an `import` or `require` Node resolves (a
// `module.registerHooks` resolve hook, which sees every load of a builtin,
// a repeated one too) and a `process.getBuiltinModule` call. A load with no
// test file running (the worker's setup, where the V8 provider loads it)
// names none, nor a call of Squeal's own provider. Once a test file of a worker loaded it, every later file of
// that worker counts as loading it too: a module the worker keeps (`isolate:
// false`, a package Node caches) holds the inspector without a second load.
//
// A file the watch saw run with no load is proved clean. It sees a file run
// before each message its worker sends (`process.send`, a thread's
// `MessagePort.postMessage`): Vitest reports every file's tests that way.
// With no resolve hook (a Node without `module.registerHooks`) it watches
// nothing, so no file is proved.
//
// Output: lines `{"t":[project,file],"i":loaded}` appended to
// `<raw>/inspector/<owner>-<pid>-<thread>.ndjson`, `owner` the Vitest
// process whose worker wrote it (the parent of a forked worker, the process
// of a thread). `readWatch` reads them in that process at the run's end, and
// `withWatch` puts them in the part's coverage header.
// CommonJS with Node built-ins only; any error of its own is swallowed.
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const module_ = require("node:module");
const url = require("node:url");
const workerThreads = require("node:worker_threads");

/** A specifier that names the inspector, with or without `node:`. */
const INSPECTOR = /^(?:node:)?inspector(?:\/promises)?$/;
const WATCH = "inspector";

const keyOf = (project, file) => `${project}\0${file}`;

/**
 * Whether the function that called `fn` is in one of `files` (absolute
 * paths): its stack frame names one, by path or by `file:` URL. A stack
 * that names no caller is no such call.
 */
function calledFrom(fn, files) {
  try {
    const holder = {};
    Error.captureStackTrace(holder, fn);
    const frame = String(holder.stack)
      .split("\n")
      .find((line) => line.trimStart().startsWith("at "));
    return frame !== undefined && files.some((file) => frame.includes(file));
  } catch {
    return false;
  }
}

/**
 * Watches this process or thread once, writing below `raw`; `raw` not a
 * string watches nothing. `provider`: the path of Squeal's coverage
 * provider, whose own `process.getBuiltinModule` call names no file (Vitest
 * evaluates it again after each file's module reset).
 */
function installWatch(raw, provider) {
  if (typeof raw !== "string" || workerThreads.isInternalThread) return;
  if (typeof module_.registerHooks !== "function" || globalThis.__squealCiInspector) return;
  globalThis.__squealCiInspector = true;
  const append = fs.appendFileSync;
  const mkdir = fs.mkdirSync;
  const dir = path.join(raw, WATCH);
  const owner = workerThreads.isMainThread ? process.ppid : process.pid;
  const out = path.join(dir, `${owner}-${process.pid}-${workerThreads.threadId}.ndjson`);
  /** Each test file written, by `keyOf`: whether it was written as loading the inspector. */
  const written = new Map();
  let loaded = false;
  /** The test file running now, a load of the inspector (`load`) or a message sent while it runs. */
  const note = (load) => {
    try {
      const state = globalThis.__vitest_worker__;
      const file = state?.filepath;
      if (typeof file !== "string") return;
      if (load) loaded = true;
      const project = String(state.ctx?.projectName ?? "");
      const key = keyOf(project, file);
      const was = written.get(key);
      if (was === true || was === loaded) return;
      written.set(key, loaded);
      mkdir(dir, { recursive: true });
      append(out, `${JSON.stringify({ t: [project, file], i: loaded })}\n`);
    } catch {}
  };
  module_.registerHooks({
    resolve(specifier, context, nextResolve) {
      if (typeof specifier === "string" && INSPECTOR.test(specifier)) note(true);
      return nextResolve(specifier, context);
    },
  });
  const own = typeof provider === "string" ? [provider, url.pathToFileURL(provider).href] : [];
  const builtin = process.getBuiltinModule;
  if (typeof builtin === "function") {
    process.getBuiltinModule = function getBuiltinModule(id, ...rest) {
      if (typeof id === "string" && INSPECTOR.test(id) && !calledFrom(getBuiltinModule, own)) {
        note(true);
      }
      return builtin.call(this, id, ...rest);
    };
  }
  const send = process.send;
  if (typeof send === "function") {
    process.send = function (...args) {
      note(false);
      return send.apply(this, args);
    };
  }
  const port = workerThreads.MessagePort?.prototype;
  const post = port?.postMessage;
  if (typeof post === "function") {
    port.postMessage = function (...args) {
      note(false);
      return post.apply(this, args);
    };
  }
}

/**
 * What the workers of this Vitest process wrote below `raw` for `modules`
 * (`{project, moduleId}`, each a test file that ended): the files that
 * loaded the inspector, and the files no watched worker saw run.
 */
function readWatch(raw, modules) {
  const seen = new Map();
  try {
    const dir = path.join(raw, WATCH);
    const own = `${process.pid}-`;
    const names = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
    for (const name of names.filter((n) => n.startsWith(own) && n.endsWith(".ndjson"))) {
      for (const line of fs.readFileSync(path.join(dir, name), "utf8").split("\n")) {
        const value = parseLine(line);
        if (value === null) continue;
        const key = keyOf(value.t[0], value.t[1]);
        seen.set(key, seen.get(key) === true || value.i === true);
      }
    }
  } catch {}
  const loaded = [];
  const unknown = [];
  for (const { project, moduleId } of modules) {
    const was = seen.get(keyOf(project, moduleId));
    if (was === true) loaded.push({ project, path: moduleId });
    else if (was === undefined) unknown.push({ project, path: moduleId });
  }
  return { loaded, unknown };
}

/** Whether a coverage provider may have been in the run `header` describes: Squeal's, or the project's. */
const providerRan = (header) =>
  header.on === true || header.off === "project-coverage" || header.off === "failed";

/**
 * `coverage.cjs`'s `covered` (`header`, `files` by `keyOf`) with, when a
 * provider ran, the header's `inspector`: the test files of `ended` whose
 * workers loaded `node:inspector`, and those no watched worker saw run
 * (`readWatch` below `raw`). A file that loaded it keeps no record. Neither
 * list: no `inspector` field. An error of its own leaves every file unknown.
 */
function withWatch(covered, raw, ended) {
  if (!providerRan(covered.header)) return covered;
  try {
    const { loaded, unknown } = readWatch(raw, ended);
    if (loaded.length === 0 && unknown.length === 0) return covered;
    const files = new Map(covered.files);
    if (covered.header.on === true) {
      for (const { project, path: file } of loaded)
        files.set(keyOf(project, file), { none: "inspector" });
    }
    return { header: { ...covered.header, inspector: { loaded, unknown } }, files };
  } catch {
    const unknown = ended.map(({ project, moduleId }) => ({ project, path: moduleId }));
    return { ...covered, header: { ...covered.header, inspector: { loaded: [], unknown } } };
  }
}

/** One line `installWatch` wrote, or `null`: a cut last line, or not one. */
function parseLine(line) {
  try {
    const value = JSON.parse(line);
    const t = value?.t;
    return Array.isArray(t) && typeof t[0] === "string" && typeof t[1] === "string" ? value : null;
  } catch {
    return null;
  }
}

module.exports = { installWatch, readWatch, withWatch };
