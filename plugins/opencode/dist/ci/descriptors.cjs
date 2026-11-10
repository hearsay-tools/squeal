// Reads and time changes through a descriptor, a file handle or a directory
// handle the run opened read-only (spec 018 D9; row 018-23, reviews
// `wave-5-0.1.421-r3.md` B1, N2 and `018-23-0.1.424.md` B1). The open hashes
// its path (`evidence-hooks.cjs`), but a read through the descriptor later
// consumes what the file holds then. So each such read hashes the file again
// through the descriptor itself, with positional reads that leave its offset
// as it was, once the read is done and before its caller sees the bytes: a
// second content is two contents for the path, which leaves it without
// evidence, and a hash that cannot be taken cancels the path. A directory
// handle lists its directory again when its reads end, when it closes and at
// the end of an iteration. A time change through a descriptor or file handle
// writes its path, as `utimes` does. An open that can write is already a
// write of its path, so only read-only opens are tracked: by descriptor
// number, a file handle's own number too, until it is closed or opened again;
// a directory handle by its object.
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

/** Wraps `target[name]` so a call on a tracked `of(this, args)` runs `after(tracked, value)` once it is done. */
function consumer(replace, target, name, of, after) {
  replace(
    target,
    name,
    (fn) =>
      function (...args) {
        const tracked = of(this, args);
        if (tracked === undefined) return fn.apply(this, args);
        return afterCall(fn, this, args, (value) => after(tracked, value));
      },
  );
}

/** Takes `evidence` (`createEvidence`) at reads and time changes through what the run opened. */
function wrapDescriptors(evidence, replace) {
  const promises = fs.promises;
  /**
   * The one owner of what the run opened: descriptor number to `{ fd, real }`,
   * for a numeric open and a file handle's `fd` alike (review of 0.1.424,
   * B1). Every open sets or clears its number, so a reused number never
   * names the file of an earlier open; every close clears it.
   */
  const fds = new Map();
  const dirs = new WeakMap();
  const throughFd = ({ fd, real }) => evidence.through(fd, real);
  const relist = ({ dir, deep }) => evidence.list(dir, deep);
  const register = (fd, real) => {
    if (typeof fd !== "number" || fd < 0) return;
    if (real === null) fds.delete(fd);
    else fds.set(fd, { fd, real });
  };
  const ofHandle = (handle) =>
    handle !== null && typeof handle === "object" && typeof handle.fd === "number"
      ? fds.get(handle.fd)
      : undefined;

  let handlesWrapped = false;
  const wrapHandles = (proto) => {
    handlesWrapped = true;
    const of = (self) => ofHandle(self);
    // `createReadStream`, `readLines` and `readableWebStream` read through `read`.
    for (const name of ["read", "readv", "readFile", "stat"]) {
      consumer(replace, proto, name, of, throughFd);
    }
    replace(
      proto,
      "utimes",
      (fn) =>
        function (...args) {
          const tracked = ofHandle(this);
          if (tracked !== undefined) evidence.write(tracked.real);
          return fn.apply(this, args);
        },
    );
    replace(
      proto,
      "close",
      (fn) =>
        function (...args) {
          if (ofHandle(this) !== undefined) fds.delete(this.fd);
          return fn.apply(this, args);
        },
    );
  };
  /** What an open gave, a descriptor or a file handle: on `real`, or `null` for one that can write. */
  const track = (opened, real) => {
    if (typeof opened === "number") register(opened, real);
    else if (opened !== null && typeof opened === "object") {
      register(opened.fd, real);
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
  consumer(replace, promises, "readFile", (_self, args) => ofHandle(args[0]), throughFd);
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

  // A directory handle lists again when its reads end or it closes: the two
  // listings bracket every entry it gave.
  const proto = fs.Dir?.prototype;
  const ofDir = (self) => dirs.get(self);
  for (const name of ["read", "readSync"]) {
    consumer(replace, proto, name, ofDir, (listing, entry) => {
      if (entry === null) relist(listing);
    });
  }
  for (const name of ["close", "closeSync"]) {
    replace(
      proto,
      name,
      (fn) =>
        function (...args) {
          const listing = dirs.get(this);
          if (listing !== undefined) relist(listing);
          return fn.apply(this, args);
        },
    );
  }
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
