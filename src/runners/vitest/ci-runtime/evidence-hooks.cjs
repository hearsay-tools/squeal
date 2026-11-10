// Where `squeal ci record`'s input evidence (`evidence.cjs`) is taken: the
// `fs` and `fs.promises` calls of the run, the modules Node resolves, and a
// process's entry point. The same calls the daemon's recorder classifies as
// reads (`f`), listings (`l`, `r`) and writes (`w`) in `observe/fs.cjs`,
// wrapped again from this CI layer, so the recorder's own runtime is not
// changed. An open is a read when it only reads, else a write of its path,
// so no descriptor, file handle or stream opened to write (`WriteStream`
// opens through `fs.open`) needs tracking; reads through one opened to read
// are `descriptors.cjs`'. A time change counts as a write; a hard link
// writes both its names, which share content. Each wrapper takes the
// evidence, then calls the original with the caller's own arguments. A child
// or Worker started with an env of its own gets the hook (`children.cjs`).
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const module_ = require("node:module");
const workerThreads = require("node:worker_threads");
const { wrapChildren } = require("./children.cjs");
const { opensToWrite, wrapDescriptors } = require("./descriptors.cjs");
const { createEvidence } = require("./evidence.cjs");

function replace(target, name, make) {
  const fn = target?.[name];
  if (typeof fn !== "function") return;
  const wrapped = make(fn);
  Object.defineProperties(wrapped, Object.getOwnPropertyDescriptors(fn));
  target[name] = wrapped;
}

/** `before(args)` first, then the call as the caller made it. */
function around(target, name, before) {
  replace(
    target,
    name,
    (fn) =>
      function (...args) {
        before(args);
        return fn.apply(this, args);
      },
  );
}

const recursive = (options) =>
  options !== null && typeof options === "object" && options.recursive === true;

/** `mkdtemp`: its prefix's directory listing before the call, the directory it made after. */
function wrapMkdtemp(target, name, evidence, promises) {
  replace(
    target,
    name,
    (fn) =>
      function (...args) {
        if (typeof args[0] === "string") evidence.entering(path.dirname(path.resolve(args[0])));
        if (target === promises) {
          const result = fn.apply(this, args);
          result.then?.(evidence.made, () => {});
          return result;
        }
        if (name === "mkdtempSync") {
          const dir = fn.apply(this, args);
          evidence.made(dir);
          return dir;
        }
        const at = args.length - 1;
        const callback = args[at];
        if (typeof callback === "function") {
          args[at] = function (...results) {
            if (!results[0]) evidence.made(results[1]);
            return callback.apply(this, results);
          };
        }
        return fn.apply(this, args);
      },
  );
}

const READS = [
  "readFile",
  "readFileSync",
  "createReadStream",
  "stat",
  "statSync",
  "lstat",
  "lstatSync",
  "exists",
  "existsSync",
  "access",
  "accessSync",
  "realpath",
  "realpathSync",
];
const LISTINGS = ["readdir", "readdirSync", "opendir", "opendirSync"];
const WRITES = [
  "writeFile",
  "writeFileSync",
  "appendFile",
  "appendFileSync",
  "createWriteStream",
  "truncate",
  "truncateSync",
  "utimes",
  "utimesSync",
  "lutimes",
  "lutimesSync",
];
const REMOVES = ["rm", "rmSync", "rmdir", "rmdirSync", "unlink", "unlinkSync"];

function wrapFs(evidence) {
  const promises = fs.promises;
  const tree = { structural: true, tree: true };
  for (const target of [fs, promises]) {
    for (const name of READS) around(target, name, (args) => evidence.read(args[0]));
    for (const name of LISTINGS) {
      around(target, name, (args) => evidence.list(args[0], recursive(args[1])));
    }
    for (const name of ["open", "openSync"]) {
      around(target, name, (args) =>
        opensToWrite(args[1]) ? evidence.write(args[0]) : evidence.read(args[0]),
      );
    }
    for (const name of WRITES) around(target, name, (args) => evidence.write(args[0]));
    for (const name of ["mkdir", "mkdirSync"]) {
      around(target, name, (args) =>
        evidence.write(args[0], { ...tree, parents: recursive(args[1]) }),
      );
    }
    for (const name of ["mkdtemp", "mkdtempSync"]) wrapMkdtemp(target, name, evidence, promises);
    for (const name of REMOVES) around(target, name, (args) => evidence.write(args[0], tree));
    for (const name of ["rename", "renameSync"]) {
      around(target, name, (args) => {
        evidence.write(args[0], tree);
        evidence.write(args[1], tree);
      });
    }
    for (const name of ["copyFile", "copyFileSync", "cp", "cpSync"]) {
      around(target, name, (args) => {
        evidence.read(args[0]);
        evidence.write(args[1], tree);
      });
    }
    for (const name of ["symlink", "symlinkSync"]) {
      around(target, name, (args) => evidence.write(args[1], { structural: true }));
    }
    for (const name of ["link", "linkSync"]) {
      around(target, name, (args) => {
        evidence.write(args[0]);
        evidence.write(args[1], { structural: true });
      });
    }
  }
}

/** The exact path a `file:` or relative specifier names, as the recorder takes it; null for a bare one. */
function named(specifier, parentURL) {
  if (typeof specifier !== "string") return null;
  if (specifier.startsWith("file:")) return new URL(specifier);
  if (!/^\.{0,2}\//.test(specifier)) return null;
  if (typeof parentURL === "string" && parentURL.startsWith("file:")) {
    return new URL(specifier, parentURL);
  }
  return path.isAbsolute(specifier) ? specifier : null;
}

const withoutQuery = (url) => new URL(url.href.replace(/[?#].*$/, ""));

/** Each module Node resolves is read; a failed resolve reads the path it names, absent. */
function wrapModules(evidence) {
  if (typeof module_.registerHooks !== "function") return;
  module_.registerHooks({
    resolve(specifier, context, nextResolve) {
      let resolved;
      try {
        resolved = nextResolve(specifier, context);
      } catch (error) {
        try {
          const target = named(specifier, context?.parentURL);
          if (target !== null) evidence.read(target instanceof URL ? withoutQuery(target) : target);
        } catch {}
        throw error;
      }
      try {
        if (typeof resolved?.url === "string" && resolved.url.startsWith("file:")) {
          evidence.read(withoutQuery(new URL(resolved.url)));
        }
      } catch {}
      return resolved;
    },
  });
}

/** The entry point of a `node script` process, and a flush before `process.send` and at exit. */
function wrapProcess(evidence) {
  const evaluated = process.execArgv.some((arg) => /^(-[a-z]*[ep]|--eval|--print)(=|$)/.test(arg));
  if (workerThreads.isMainThread && !evaluated && typeof process.argv[1] === "string") {
    evidence.read(process.argv[1]);
  }
  process.on("exit", evidence.flush);
  replace(
    process,
    "send",
    (fn) =>
      function (...args) {
        try {
          evidence.flush();
        } catch {}
        return fn.apply(this, args);
      },
  );
}

/**
 * Takes the evidence in this process or thread, once, unless it is one of
 * Node's own threads. `settings`: `out`, `root`, `skip`, `format`; `null`
 * takes none.
 */
function installEvidence(settings) {
  if (settings === null || workerThreads.isInternalThread || globalThis.__squealCiEvidence) return;
  globalThis.__squealCiEvidence = true;
  try {
    const evidence = createEvidence(settings);
    wrapFs(evidence);
    wrapDescriptors(evidence, replace);
    wrapChildren(replace);
    module_.syncBuiltinESMExports();
    wrapModules(evidence);
    wrapProcess(evidence);
  } catch {}
}

module.exports = { installEvidence };
