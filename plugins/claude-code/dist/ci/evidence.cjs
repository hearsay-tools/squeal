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
// written path for the whole run, even when its content is restored. A write
// through a symbolic link marks the path it reaches as well; a call on the
// entry itself (`how.entry`: a removal or a rename) follows only the links
// above it, since it leaves what its own link reaches as it was (row 018-43).
// `argument(p)`: `read(p)` of a file a spawn names in its arguments, as the
// daemon's recorder reads it (`observe/spawn.cjs`, `recordArguments`; row
// 018-43), known as a file without a call that recorder observes. `through(fd,
// real)`: a read through a descriptor the run opened read-only on `real`
// (`opened`), the content its file holds now, hashed through that descriptor
// (`descriptors.cjs`; row 018-23).
//
// Each value a path shows goes out, two in one turn too: the reader drops a
// path with two contents, or content and absence, in the run (repair R3).
//
// The calls it makes itself only read paths the run is reading at that
// moment, as the run does, so the daemon's recorder in the same process
// records nothing new; for a written path it asks only `readlink`, which that
// recorder does not observe.
//
// Output: lines `{"e":{path:hash|null}}` and `{"w":[path],"t":[path]}`
// appended to `<out>/<pid>-<thread>-<time>.ndjson`: `e` evidence, `w` paths
// written, `t` paths written with everything below them (`""` the root: every
// path, a withheld run). Paths are relative to the root with `/`; a listing
// path ends in `/` (`./` the root's). Each line also holds `o`, the time
// this thread's clock (`clock.cjs`) had at that line, in milliseconds; a line
// with `o` alone goes out when the clock moved `DUE_MS` without a line, and
// on `flush` (row 018-29).
// Evidence goes out once per event-loop turn, and on `flush`; a write before
// the call that makes it, so a process stopped at any point never leaves a
// write out. A lost read only leaves its test file out.
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const workerThreads = require("node:worker_threads");
const { fileURLToPath } = require("node:url");
const clock = require("./clock.cjs");

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

/** Time on the clock without a line that makes a line of its own: what a stopped process can lose. */
const DUE_MS = 20;

/** A file changed this recently may change again with the same stat (coarse file times). */
const SETTLED_MS = 2000;

/**
 * What git stores for a path now (`hashFile`): `ofPath(abs)`, and through an
 * open descriptor `ofOpen(fd, abs)` with positional reads, which leave its
 * offset as it was. `null` no file; `undefined` unknown. A file whose stat is
 * the one it had at its last hash in this process is not read again, unless
 * it had changed within `SETTLED_MS` of that hash.
 */
function contents(original, format) {
  const now = Date.now;
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
  const ofOpen = (fd, abs) => {
    try {
      const at = now();
      const stat = original.fstatSync(fd);
      if (!stat.isFile()) return null;
      const signature = `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
      const known = hashed.get(abs);
      if (known?.signature === signature) return known.hash;
      const bytes = bytesOf(fd, stat.size);
      const hash = bytes === undefined ? undefined : blob(bytes);
      if (at - Math.max(stat.mtimeMs, stat.ctimeMs) > SETTLED_MS) {
        hashed.set(abs, { signature, hash });
      } else hashed.delete(abs);
      return hash;
    } catch {
      return undefined;
    }
  };
  const ofPath = (abs) => {
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
      return ofOpen(fd, abs);
    } finally {
      try {
        original.closeSync(fd);
      } catch {}
    }
  };
  return { ofPath, ofOpen };
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
  /** A symlink's target, in the root's own spelling. */
  const target = (abs) => {
    const real = original.realpath(abs);
    return realRoot !== root && real.startsWith(realRoot)
      ? root + real.slice(realRoot.length)
      : real;
  };
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
    target,
    /** Whether `abs` is a file now, links followed, by `realpath` of it and of it as a directory. */
    isFile: (abs) => {
      try {
        original.realpath(abs);
      } catch {
        return false;
      }
      try {
        original.realpath(`${abs}${path.sep}`);
        return false;
      } catch (error) {
        return error?.code === "ENOTDIR";
      }
    },
    /**
     * The path a write to `abs` reaches, each symbolic link on its way
     * followed, a dangling last one too, or with `last` false the links
     * above it only; by `realpath` and `readlink`, which no recorder observes.
     */
    reached: (abs, last = true) => {
      let at = abs;
      for (let hops = 0; hops < 40; hops += 1) {
        const parent = path.dirname(at);
        let dir;
        try {
          dir = `${parent}${path.sep}` === root ? parent : target(parent);
        } catch {
          return at;
        }
        const here = path.join(dir, path.basename(at));
        if (!last) return here;
        try {
          at = path.resolve(dir, original.readlinkSync(here));
        } catch {
          return here;
        }
      }
      return at;
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
  /** Paths this process wrote, and trees: their evidence is cancelled for the run. */
  const gone = new Set();
  const goneTrees = new Set();
  const realSetImmediate = setImmediate;
  /** The clock's time at the last line. */
  let told = 0;
  const append = (value) => {
    told = clock.spent();
    try {
      const o = Math.round(told * 1000) / 1000;
      original.appendFileSync(file, `${JSON.stringify({ ...value, o })}\n`);
    } catch {}
  };
  const flushEvidence = () => {
    if (!any) return;
    const e = pending;
    pending = {};
    any = false;
    append({ e });
  };
  /** The evidence of this turn, or the clock alone when it moved since the last line. */
  const flush = clock.timed(() => {
    scheduled = false;
    if (any) flushEvidence();
    else if (clock.spent() > told) append({});
  });
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    realSetImmediate(flush).unref();
  };
  return {
    flush,
    /** A line soon when the clock moved `DUE_MS` since the last. */
    due: () => {
      if (!scheduled && clock.spent() - told >= DUE_MS) schedule();
    },
    evidence: (rel, value) => {
      if (value === undefined || last.get(rel) === value) return;
      // Another value in the same turn goes out beside the first, not over it.
      if (Object.hasOwn(pending, rel)) flushEvidence();
      last.set(rel, value);
      pending[rel] = value;
      any = true;
      schedule();
    },
    written: (exact, trees) => {
      if (exact.length === 0 && trees.length === 0) return;
      for (const rel of [...exact, ...trees]) last.delete(rel);
      for (const rel of exact) gone.add(rel);
      for (const rel of trees) goneTrees.add(rel);
      flushEvidence();
      append({ w: exact, t: trees });
    },
    gone: (rel) => {
      if (gone.has(rel) || goneTrees.has("")) return true;
      for (let at = rel.indexOf("/"); at !== -1; at = rel.indexOf("/", at + 1)) {
        if (goneTrees.has(rel.slice(0, at))) return true;
      }
      return goneTrees.has(rel);
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
      out.evidence(paths.relative(abs), content.ofPath(abs));
      const target = paths.target(abs);
      if (target !== abs && paths.kept(target)) {
        out.evidence(paths.relative(target), content.ofPath(target));
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
   * `abs` written; its directory's listing too when `abs` does not exist yet
   * or the call is `structural` (a create, delete or rename). `tree`: all
   * below `abs` too. `parents`: each missing directory above, as `mkdir -p`
   * makes.
   */
  const mark = (abs, { structural = false, tree = false, parents = false }) => {
    try {
      const rel = paths.scoped(abs);
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
  /**
   * `p` written, and the path it reaches through symbolic links (`mark`);
   * with `how.entry`, through the links above it only.
   */
  const write = (p, how = {}) => {
    try {
      const abs = paths.toPath(p);
      if (abs === null) return;
      mark(abs, how);
      const real = paths.reached(abs, how.entry !== true);
      if (real !== abs) mark(real, how);
    } catch {}
  };
  /** A file a spawn names in its arguments: read, as the daemon's recorder reads it. */
  const argument = (p) => {
    try {
      const abs = paths.toPath(p);
      if (abs !== null && paths.kept(abs) && paths.isFile(abs)) read(abs);
    } catch {}
  };
  /** The listing of a directory a call creates an entry in (`mkdtemp`'s prefix). */
  const entering = (dir) => {
    try {
      const rel = paths.scoped(dir);
      if (rel !== null) out.written([listing(rel)], []);
    } catch {}
  };
  /** The kept path a read-only open of `p` reads, links followed, for `through`; else `null`. */
  const opened = (p) => {
    try {
      const abs = paths.toPath(p);
      const real = abs === null ? null : paths.target(abs);
      return real !== null && paths.kept(real) && real !== `${paths.root}.git` ? real : null;
    } catch {
      return null;
    }
  };
  /** A read through `fd`, opened on `real` (`opened`): the content it holds now; unknown cancels. */
  const through = (fd, real) => {
    try {
      const rel = paths.relative(real);
      // Written here already: no evidence to keep, so no hash at each chunk of a stream.
      if (out.gone(rel)) return;
      const value = content.ofOpen(fd, real);
      if (value === undefined) out.written([rel], []);
      else out.evidence(rel, value);
    } catch {}
  };
  /**
   * Test file `file` withheld from the export: its own path written, so no
   * closure holding it is certified; with `file` `null` or outside the root,
   * every path (row 018-23, review of 0.1.424, B2).
   */
  const withhold = (file) => {
    let rel = null;
    try {
      rel = file === null ? null : paths.scoped(file);
    } catch {}
    try {
      if (rel === null || rel === "") out.written([], [""]);
      else out.written([rel], []);
    } catch {}
  };
  /** A path created, with all below it. */
  const made = (p) => {
    try {
      const rel = paths.scoped(p);
      if (rel !== null && rel !== "") out.written([], [rel]);
    } catch {}
  };
  /** `fn` on the clock, and a line of its own when the clock is due one (`DUE_MS`). */
  const timed = (fn) => {
    const onClock = clock.timed(fn);
    return (...args) => {
      const value = onClock(...args);
      out.due();
      return value;
    };
  };
  return {
    read: timed(read),
    list: timed(list),
    write: timed(write),
    argument: timed(argument),
    entering: timed(entering),
    made: timed(made),
    opened: timed(opened),
    through: timed(through),
    withhold: timed(withhold),
    flush: out.flush,
    toPath: paths.toPath,
  };
}

module.exports = { createEvidence };
