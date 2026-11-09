// `squeal ci record`'s input evidence (spec 018 D8, D9 as amended
// 2026-11-09: "one owner for input evidence"; review of 0.1.421, second
// round, B1): what the run's own reads saw, taken at the moment it read.
// `evidence-hooks.cjs` calls it from the `fs` calls and module loads of every
// process and thread of the recorded command; the daemon never loads it.
//
// `read(p)`: the content of `p` now, as git stores it (`hashFile`), `null`
// when there is no file, and its symlink target's when that is kept.
// `list(p, recursive)`: the names in directory `p` now (`namesHash`), each
// directory's below it for a recursive listing, `ABSENT_LISTING` when there
// is none. `write(p, how)`: `p` written, before the call that writes it, and
// its directory's listing when `p` appears or goes; the export certifies no
// written path for the whole run, even when its content is restored.
//
// The calls it makes itself only read paths the run is reading at that
// moment, as the run does, so the daemon's recorder in the same process
// records nothing new; for a written path it asks only `readlink`, which that
// recorder does not observe.
//
// Output: lines `{"e":{path:hash|null}}` and `{"w":[path],"t":[path]}`
// appended to `<out>/<pid>-<thread>-<time>.ndjson`: `e` evidence, `w` paths
// written, `t` paths written with everything below them. Paths are relative
// to the root with `/`; a listing path ends in `/` (`./` the root's).
// Evidence goes out once per event-loop turn, and on `flush`; a write before
// the call that makes it, so a process stopped at any point never leaves a
// write out. A lost read only leaves its test file out.
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const workerThreads = require("node:worker_threads");
const { fileURLToPath } = require("node:url");

const OPEN_FLAGS =
  fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0) | (fs.constants.O_NONBLOCK ?? 0);
const MISSING = new Set(["ENOENT", "ENOTDIR"]);
/** `ABSENT_LISTING` in `src/core/keys/observed.ts`. */
const ABSENT_LISTING = crypto.createHash("sha1").update("\0absent").digest("hex");

/** `namesHash` in `src/core/keys/observed.ts`: code-unit order, joined by NUL. */
function namesHash(names) {
  const sorted = [...names].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return crypto.createHash("sha1").update(sorted.join("\0")).digest("hex");
}

/** The `fs` functions as they were before `evidence-hooks.cjs` wrapped them. */
function originals() {
  return {
    openSync: fs.openSync,
    closeSync: fs.closeSync,
    fstatSync: fs.fstatSync,
    readSync: fs.readSync,
    readlinkSync: fs.readlinkSync,
    readdirSync: fs.readdirSync,
    statSync: fs.statSync,
    appendFileSync: fs.appendFileSync,
    realpath: fs.realpathSync.native,
  };
}

/**
 * What git stores for a path now (`hashFile`): `null` no file; `undefined`
 * unknown. A file whose stat is the one it had at its last hash in this
 * process is not read again.
 */
function contents(original, format) {
  const blob = (bytes) =>
    crypto.createHash(format).update(`blob ${bytes.byteLength}\0`).update(bytes).digest("hex");
  const hashed = new Map();
  const bytesOf = (fd, size) => {
    const bytes = Buffer.allocUnsafe(size);
    for (let at = 0; at < size; ) {
      const n = original.readSync(fd, bytes, at, size - at, at);
      if (n === 0) return undefined;
      at += n;
    }
    // A file that grew since the stat is being written: no evidence.
    return original.readSync(fd, Buffer.alloc(1), 0, 1, size) === 0 ? bytes : undefined;
  };
  return (abs) => {
    let fd;
    try {
      fd = original.openSync(abs, OPEN_FLAGS);
    } catch (error) {
      if (MISSING.has(error?.code)) return null;
      if (error?.code !== "ELOOP") return undefined;
      try {
        return blob(original.readlinkSync(abs, { encoding: "buffer" }));
      } catch (again) {
        return MISSING.has(again?.code) ? null : undefined;
      }
    }
    try {
      const stat = original.fstatSync(fd);
      if (!stat.isFile()) return null;
      const signature = `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
      const known = hashed.get(abs);
      if (known?.signature === signature) return known.hash;
      const bytes = bytesOf(fd, stat.size);
      const hash = bytes === undefined ? undefined : blob(bytes);
      hashed.set(abs, { signature, hash });
      return hash;
    } catch {
      return undefined;
    } finally {
      try {
        original.closeSync(fd);
      } catch {}
    }
  };
}

/** The worktree's `.git` by its kind, as `gitEntryHash` keys it. */
function gitKindOf(original, abs) {
  try {
    const stat = original.statSync(abs, { throwIfNoEntry: false });
    if (stat === undefined) return null;
    const kind = stat.isDirectory() ? "directory" : "file";
    return crypto.createHash("sha1").update(`.git ${kind}`).digest("hex");
  } catch {
    return undefined;
  }
}

/** Per directory below and at `abs`, the names in it, from one recursive listing with file types. */
function namesBelow(entries, abs) {
  const names = new Map([[abs, []]]);
  for (const entry of entries) {
    const parent = entry.parentPath ?? entry.path;
    if (!names.has(parent)) names.set(parent, []);
    names.get(parent).push(entry.name);
    const below = path.join(parent, entry.name);
    if (entry.isDirectory() && !names.has(below)) names.set(below, []);
  }
  return names;
}

/** Paths as the recorder keeps them (`recorder.cjs`): below the root, outside `.git`, `node_modules` and `skip`. */
function pathsOf(settings, original) {
  const root = settings.root.endsWith(path.sep) ? settings.root : settings.root + path.sep;
  let realRoot = root;
  try {
    realRoot = original.realpath(root) + path.sep;
  } catch {}
  const skip = [settings.out, ...settings.skip].map((p) =>
    p.endsWith(path.sep) ? p : p + path.sep,
  );
  const gitDir = `${root}.git${path.sep}`;
  const nodeModules = `${path.sep}node_modules${path.sep}`;
  const toPath = (p) => {
    if (typeof p === "string") return path.resolve(p);
    if (p instanceof URL) return p.protocol === "file:" ? fileURLToPath(p) : null;
    if (Buffer.isBuffer(p)) return path.resolve(p.toString());
    return null;
  };
  const kept = (abs) =>
    abs.startsWith(root) &&
    !abs.startsWith(gitDir) &&
    !abs.includes(nodeModules) &&
    !skip.some((prefix) => abs.startsWith(prefix) || `${abs}${path.sep}` === prefix);
  const relative = (abs) => abs.slice(root.length).split(path.sep).join("/");
  return {
    root,
    toPath,
    kept,
    relative,
    absolute: (rel) => (rel === "" ? root : root + rel.split("/").join(path.sep)),
    /** `p` as a kept relative path; `""` for the root itself; `null` outside. */
    scoped: (p) => {
      const abs = toPath(p);
      if (abs === null) return null;
      if (`${abs}${path.sep}` === root) return "";
      return kept(abs) ? relative(abs) : null;
    },
    /** A symlink's target, in the root's own spelling. */
    target: (abs) => {
      const target = original.realpath(abs);
      return realRoot !== root && target.startsWith(realRoot)
        ? root + target.slice(realRoot.length)
        : target;
    },
  };
}

const listing = (rel) => (rel === "" ? "./" : `${rel}/`);
const parentListing = (rel) => listing(rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "");

/** The output of one process or thread: evidence batched per turn, writes at once. */
function outputOf(settings, original) {
  const file = path.join(
    settings.out,
    `${process.pid}-${workerThreads.threadId}-${Date.now().toString(36)}.ndjson`,
  );
  let pending = {};
  let any = false;
  let scheduled = false;
  const last = new Map();
  const realSetImmediate = setImmediate;
  const append = (value) => {
    try {
      original.appendFileSync(file, `${JSON.stringify(value)}\n`);
    } catch {}
  };
  const flush = () => {
    scheduled = false;
    if (!any) return;
    const e = pending;
    pending = {};
    any = false;
    append({ e });
  };
  return {
    flush,
    evidence: (rel, value) => {
      if (value === undefined || last.get(rel) === value) return;
      last.set(rel, value);
      pending[rel] = value;
      any = true;
      if (!scheduled) {
        scheduled = true;
        realSetImmediate(flush).unref();
      }
    },
    written: (exact, trees) => {
      if (exact.length === 0 && trees.length === 0) return;
      for (const rel of [...exact, ...trees]) last.delete(rel);
      flush();
      append({ w: exact, t: trees });
    },
  };
}

/** The evidence of this process or thread; `settings`: `out`, `root`, `skip`, `format`. */
function createEvidence(settings) {
  const original = originals();
  const content = contents(original, settings.format === "sha256" ? "sha256" : "sha1");
  const paths = pathsOf(settings, original);
  const out = outputOf(settings, original);
  /** Whether `abs` names anything now, by `readlink`, which no recorder observes. */
  const exists = (abs) => {
    try {
      original.readlinkSync(abs);
      return true;
    } catch (error) {
      return !MISSING.has(error?.code);
    }
  };
  const read = (p) => {
    try {
      const abs = paths.toPath(p);
      if (abs === null) return;
      if (abs === `${paths.root}.git`) return out.evidence(".git", gitKindOf(original, abs));
      if (!paths.kept(abs)) return;
      out.evidence(paths.relative(abs), content(abs));
      const target = paths.target(abs);
      if (target !== abs && paths.kept(target)) {
        out.evidence(paths.relative(target), content(target));
      }
    } catch {}
  };
  const list = (p, recursive) => {
    try {
      const rel = paths.scoped(p);
      if (rel === null) return;
      const abs = rel === "" ? paths.root.slice(0, -1) : paths.absolute(rel);
      let entries;
      try {
        entries = recursive
          ? original.readdirSync(abs, { recursive: true, withFileTypes: true })
          : original.readdirSync(abs);
      } catch (error) {
        if (MISSING.has(error?.code)) out.evidence(listing(rel), ABSENT_LISTING);
        return;
      }
      if (!recursive) return out.evidence(listing(rel), namesHash(entries));
      for (const [dir, names] of namesBelow(entries, abs)) {
        const at =
          `${dir}${path.sep}` === paths.root ? "" : paths.kept(dir) ? paths.relative(dir) : null;
        if (at !== null) out.evidence(listing(at), namesHash(names));
      }
    } catch {}
  };
  /**
   * `p` written; its directory's listing too when `p` does not exist yet or
   * the call is `structural` (a create, delete or rename). `tree`: all below
   * `p` too. `parents`: each missing directory above, as `mkdir -p` makes.
   */
  const write = (p, { structural = false, tree = false, parents = false } = {}) => {
    try {
      const rel = paths.scoped(p);
      if (rel === null || rel === "") return;
      const exact = [];
      const trees = [];
      (tree ? trees : exact).push(rel);
      if (structural || !exists(paths.absolute(rel))) exact.push(parentListing(rel));
      for (let at = rel.lastIndexOf("/"); parents && at > 0; at = rel.lastIndexOf("/", at - 1)) {
        const above = rel.slice(0, at);
        if (exists(paths.absolute(above))) break;
        trees.push(above);
        exact.push(parentListing(above));
      }
      out.written(exact, trees);
    } catch {}
  };
  /** The listing of a directory a call creates an entry in (`mkdtemp`'s prefix). */
  const entering = (dir) => {
    try {
      const rel = paths.scoped(dir);
      if (rel !== null) out.written([listing(rel)], []);
    } catch {}
  };
  /** A path created, with all below it. */
  const made = (p) => {
    try {
      const rel = paths.scoped(p);
      if (rel !== null && rel !== "") out.written([], [rel]);
    } catch {}
  };
  return { read, list, write, entering, made, flush: out.flush };
}

module.exports = { createEvidence };
