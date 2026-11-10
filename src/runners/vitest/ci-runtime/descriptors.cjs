// Reads and time changes through a descriptor, a file handle or a directory
// handle the run opened read-only (spec 018 D9; row 018-23, review
// `wave-5-0.1.421-r3.md` B1 and N2). The open hashes its path
// (`evidence-hooks.cjs`), but a read through the descriptor later consumes
// what the file holds then. So each such read hashes the file again through
// the descriptor itself, once the read is done and before its caller sees
// the bytes: a second content is two contents for the path, which leaves it
// without evidence, and a hash that cannot be taken cancels the path. A
// directory handle lists its directory again at each read and at the end of
// an iteration. A time change through a descriptor or file handle writes its
// path, as `utimes` does. An open that can write is already a write of its
// path, so only read-only opens are tracked, by descriptor number until it
// is closed, and by file handle or directory handle object.
"use strict";
const fs = require("node:fs");

const { O_RDONLY, O_CREAT, O_TRUNC, O_APPEND } = fs.constants;
/** Node's string flags that can write (`stringToFlags`): `w`, `a` or `+`. */
const WRITING = /[wa+]/;

/** Whether an open with `flags` can change the file: anything but read-only. */
function opensToWrite(flags) {
  if (typeof flags === "number") {
    return (flags & 3) !== O_RDONLY || (flags & (O_CREAT | O_TRUNC | O_APPEND)) !== 0;
  }
  return typeof flags === "string" && WRITING.test(flags);
}

const recursive = (options) =>
  options !== null && typeof options === "object" && options.recursive === true;

/**
 * Calls `fn` as the caller did, then `after(value)` once the call's value is
 * there: at its return, first in its callback, or first on its promise. A
 * failed call calls nothing.
 */
function afterCall(fn, self, args, after) {
  const safe = (value) => {
    try {
      after(value);
    } catch {}
  };
  const at = args.length - 1;
  const callback = args[at];
  if (typeof callback === "function") {
    args[at] = function (...results) {
      if (results[0] == null) safe(results[1]);
      return callback.apply(this, results);
    };
    return fn.apply(self, args);
  }
  const result = fn.apply(self, args);
  if (typeof result?.then === "function") result.then(safe, () => {});
  else safe(result);
  return result;
}

/** Wraps `target[name]` so a call on a tracked `of(this, args)` runs `after` once it is done. */
function consumer(replace, target, name, of, after) {
  replace(
    target,
    name,
    (fn) =>
      function (...args) {
        const tracked = of(this, args);
        if (tracked === undefined) return fn.apply(this, args);
        return afterCall(fn, this, args, () => after(tracked));
      },
  );
}

/** Takes `evidence` (`createEvidence`) at reads and time changes through what the run opened. */
function wrapDescriptors(evidence, replace) {
  const promises = fs.promises;
  /** Descriptor number to `{ fd, real }`; file handle to `{ handle, real }`; directory handle to its listing. */
  const fds = new Map();
  const handles = new WeakMap();
  const dirs = new WeakMap();
  const throughFd = ({ fd, real }) => evidence.through(fd, real);
  const throughHandle = ({ handle, real }) => evidence.through(handle.fd, real);
  const relist = ({ dir, deep }) => evidence.list(dir, deep);

  let handlesWrapped = false;
  const wrapHandles = (proto) => {
    handlesWrapped = true;
    const of = (self) => handles.get(self);
    // `createReadStream`, `readLines` and `readableWebStream` read through `read`.
    for (const name of ["read", "readv", "readFile", "stat"]) {
      consumer(replace, proto, name, of, throughHandle);
    }
    replace(
      proto,
      "utimes",
      (fn) =>
        function (...args) {
          const tracked = handles.get(this);
          if (tracked !== undefined) evidence.write(tracked.real);
          return fn.apply(this, args);
        },
    );
  };
  /** What an open gave: a descriptor or file handle on `real`, or `null` for one that can write. */
  const track = (opened, real) => {
    if (typeof opened === "number") {
      if (real === null) fds.delete(opened);
      else fds.set(opened, { fd: opened, real });
    } else if (real !== null && opened !== null && typeof opened === "object") {
      handles.set(opened, { handle: opened, real });
      if (!handlesWrapped) wrapHandles(Object.getPrototypeOf(opened));
    }
  };

  for (const target of [fs, promises]) {
    for (const name of ["open", "openSync"]) {
      replace(
        target,
        name,
        (fn) =>
          function (...args) {
            const reading = !opensToWrite(args[1]);
            const p = args[0];
            return afterCall(fn, this, args, (opened) =>
              track(opened, reading ? evidence.opened(p) : null),
            );
          },
      );
    }
    for (const name of ["opendir", "opendirSync"]) {
      replace(
        target,
        name,
        (fn) =>
          function (...args) {
            const listing = { dir: evidence.toPath(args[0]), deep: recursive(args[1]) };
            return afterCall(fn, this, args, (dir) => {
              if (listing.dir !== null && dir !== null && typeof dir === "object") {
                dirs.set(dir, listing);
              }
            });
          },
      );
    }
  }
  const ofFd = (_self, args) => (typeof args[0] === "number" ? fds.get(args[0]) : undefined);
  const reads = ["read", "readSync", "readv", "readvSync", "readFile", "readFileSync"];
  for (const name of [...reads, "fstat", "fstatSync"]) consumer(replace, fs, name, ofFd, throughFd);
  consumer(replace, promises, "readFile", (_self, args) => handles.get(args[0]), throughHandle);
  for (const name of ["futimes", "futimesSync"]) {
    replace(
      fs,
      name,
      (fn) =>
        function (...args) {
          const tracked = ofFd(this, args);
          if (tracked !== undefined) evidence.write(tracked.real);
          return fn.apply(this, args);
        },
    );
  }
  for (const name of ["close", "closeSync"]) {
    replace(
      fs,
      name,
      (fn) =>
        function (...args) {
          if (typeof args[0] === "number") fds.delete(args[0]);
          return fn.apply(this, args);
        },
    );
  }

  const proto = fs.Dir?.prototype;
  const ofDir = (self) => dirs.get(self);
  for (const name of ["read", "readSync"]) consumer(replace, proto, name, ofDir, relist);
  for (const name of ["entries", Symbol.asyncIterator]) {
    replace(
      proto,
      name,
      (fn) =>
        async function* (...args) {
          try {
            yield* fn.apply(this, args);
          } finally {
            const listing = dirs.get(this);
            if (listing !== undefined) relist(listing);
          }
        },
    );
  }
}

module.exports = { opensToWrite, wrapDescriptors };
