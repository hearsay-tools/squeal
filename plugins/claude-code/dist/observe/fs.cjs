// The recorder's `fs` wrappers (`recorder.cjs`; spec 001 D4; tasks 001-132,
// 001-135). Classifies what a call does, not the permission it asks for: an
// open that can read is a read; an open is a write only when it truncates or
// creates; a descriptor or FileHandle is a write when something writes,
// appends or truncates through it (review wave 12d, B3). Each wrapper records,
// then calls the original with the caller's own arguments.
"use strict";
const fs = require("node:fs");

const { O_RDONLY, O_WRONLY, O_RDWR, O_CREAT, O_TRUNC, O_APPEND, O_EXCL } = fs.constants;
const O_ACCMODE = 3;
const R = O_RDONLY;
const RW = O_RDWR;
const W = O_TRUNC | O_CREAT | O_WRONLY;
const WP = O_TRUNC | O_CREAT | O_RDWR;
const A = O_APPEND | O_CREAT | O_WRONLY;
const AP = O_APPEND | O_CREAT | O_RDWR;
/** Node's string flags as open(2) flags (`stringToFlags`); `x` only adds O_EXCL. */
const FLAGS = {
  r: R,
  rs: R,
  sr: R,
  "r+": RW,
  "rs+": RW,
  "sr+": RW,
  w: W,
  wx: W | O_EXCL,
  xw: W | O_EXCL,
  "w+": WP,
  "wx+": WP | O_EXCL,
  "xw+": WP | O_EXCL,
  a: A,
  ax: A | O_EXCL,
  xa: A | O_EXCL,
  as: A,
  sa: A,
  "a+": AP,
  "ax+": AP | O_EXCL,
  "xa+": AP | O_EXCL,
  "as+": AP,
  "sa+": AP,
};

/**
 * Wraps `fs` and `fs.promises` for `api`: `scoped(p)` the absolute path of a
 * recordable `p`, or `null`; `record(kind, abs)` with kind `f` read, `l`
 * listed, `w` written.
 */
function wrapFs(api) {
  const { lstatSync } = fs;
  const promises = fs.promises;
  /** Descriptors and FileHandles opened on a recordable path. */
  const fds = new Map();
  const handles = new WeakMap();
  const pathOf = (p) => {
    if (typeof p === "number") return fds.get(p) ?? null;
    if (p !== null && typeof p === "object" && handles.has(p)) return handles.get(p);
    return api.scoped(p);
  };
  const record = (kind, p) => {
    try {
      const abs = pathOf(p);
      if (abs !== null) api.record(kind, abs);
    } catch {
      // never the test's failure
    }
  };

  const replace = (target, name, make) => {
    const original = target?.[name];
    if (typeof original !== "function") return;
    const wrapped = make(original);
    Object.defineProperties(wrapped, Object.getOwnPropertyDescriptors(original));
    target[name] = wrapped;
  };
  const wrap = (target, name, kind, index = 0) =>
    replace(
      target,
      name,
      (original) =>
        function (...args) {
          record(kind, args[index]);
          return original.apply(this, args);
        },
    );
  const forget = (target, name) =>
    replace(
      target,
      name,
      (original) =>
        function (...args) {
          if (typeof args[0] === "number") fds.delete(args[0]);
          return original.apply(this, args);
        },
    );

  /** Records what opening `abs` with `flags` does; `undefined` flags Node rejects. */
  const opening = (abs, flags) => {
    const f =
      flags == null || typeof flags === "function"
        ? R
        : typeof flags === "number"
          ? flags
          : FLAGS[flags];
    if (typeof f !== "number") return;
    if ((f & O_ACCMODE) !== O_WRONLY) api.record("f", abs);
    const creates = (f & O_CREAT) !== 0 && lstatSync(abs, { throwIfNoEntry: false }) === undefined;
    if ((f & O_TRUNC) !== 0 || creates) api.record("w", abs);
  };
  let handlesWrapped = false;
  const track = (opened, abs) => {
    if (typeof opened === "number") fds.set(opened, abs);
    else if (opened !== null && typeof opened === "object") {
      handles.set(opened, abs);
      if (!handlesWrapped) {
        handlesWrapped = true;
        wrapHandles(Object.getPrototypeOf(opened));
      }
    }
  };
  const wrapHandles = (proto) => {
    for (const name of [
      "write",
      "writev",
      "writeFile",
      "appendFile",
      "truncate",
      "createWriteStream",
    ]) {
      replace(
        proto,
        name,
        (original) =>
          function (...args) {
            record("w", this);
            return original.apply(this, args);
          },
      );
    }
  };
  const wrapOpen = (target, name) =>
    replace(
      target,
      name,
      (original) =>
        function (p, ...rest) {
          let abs = null;
          try {
            abs = api.scoped(p);
            if (abs !== null) opening(abs, rest[0]);
          } catch {
            abs = null;
          }
          if (abs === null) return original.call(this, p, ...rest);
          if (target === promises) {
            const result = original.call(this, p, ...rest);
            result.then?.(
              (handle) => track(handle, abs),
              () => {},
            );
            return result;
          }
          if (name === "openSync") {
            const fd = original.call(this, p, ...rest);
            track(fd, abs);
            return fd;
          }
          const at = rest.length - 1;
          const callback = rest[at];
          if (typeof callback === "function") {
            rest[at] = function (...results) {
              if (!results[0]) track(results[1], abs);
              return callback.apply(this, results);
            };
          }
          return original.call(this, p, ...rest);
        },
    );

  for (const target of [fs, promises]) {
    for (const name of ["readFile", "readFileSync", "createReadStream"]) wrap(target, name, "f");
    for (const name of ["stat", "statSync", "lstat", "lstatSync", "exists", "existsSync"]) {
      wrap(target, name, "f");
    }
    for (const name of ["access", "accessSync", "realpath", "realpathSync"])
      wrap(target, name, "f");
    for (const name of ["readdir", "readdirSync", "opendir", "opendirSync"])
      wrap(target, name, "l");
    for (const name of ["writeFile", "writeFileSync", "appendFile", "appendFileSync"]) {
      wrap(target, name, "w");
    }
    for (const name of ["createWriteStream", "mkdir", "mkdirSync", "rm", "rmSync"]) {
      wrap(target, name, "w");
    }
    for (const name of ["unlink", "unlinkSync", "rmdir", "rmdirSync", "truncate", "truncateSync"]) {
      wrap(target, name, "w");
    }
    for (const name of ["copyFile", "copyFileSync", "cp", "cpSync"]) {
      wrap(target, name, "f", 0);
      wrap(target, name, "w", 1);
    }
    // a rename's source is gone afterwards: both ends are written
    for (const name of ["rename", "renameSync"]) {
      wrap(target, name, "w", 0);
      wrap(target, name, "w", 1);
    }
    for (const name of ["open", "openSync"]) wrapOpen(target, name);
  }
  // what is written through a descriptor
  for (const name of ["write", "writeSync", "writev", "writevSync", "ftruncate", "ftruncateSync"]) {
    wrap(fs, name, "w");
  }
  for (const name of ["close", "closeSync"]) forget(fs, name);
}

module.exports = { wrapFs };
