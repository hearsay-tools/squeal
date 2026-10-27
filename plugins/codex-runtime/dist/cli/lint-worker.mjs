import { createRequire as __squealCreateRequire } from "node:module";
const require = __squealCreateRequire(import.meta.url);

// src/core/lint/provider/worker.ts
import { parentPort, workerData } from "node:worker_threads";

// src/core/lint/provider/observe.ts
import fs2 from "node:fs";
import { registerHooks, syncBuiltinESMExports } from "node:module";
import { sep as sep3 } from "node:path";
import { fileURLToPath as fileURLToPath3, pathToFileURL } from "node:url";

// src/core/hash/blob.ts
import { createHash } from "node:crypto";
import { constants } from "node:fs";
function blobHash(bytes, format2) {
  return createHash(format2).update(`blob ${bytes.byteLength}\0`).update(bytes).digest("hex");
}
var OPEN_FLAGS = constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;

// src/core/lint/provider/loaded.ts
import { isAbsolute, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
var NODE_MODULES = `${sep}node_modules${sep}`;
function sortLoaded(urls, root2) {
  const closure = /* @__PURE__ */ new Set();
  const packages = /* @__PURE__ */ new Set();
  for (const url of urls) {
    if (!url.startsWith("file:")) continue;
    const path = fileURLToPath(url.split("?")[0] ?? url);
    const pkg = packageRoot(path);
    const inside = projectPath(path, root2);
    if (pkg !== null) packages.add(pkg);
    else if (inside !== null) closure.add(inside);
    else packages.add(path);
  }
  return { closure: [...closure].sort(), packages: [...packages].sort() };
}
function projectPath(path, root2) {
  const rel = relative(root2, path);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) return null;
  if (`${sep}${rel}${sep}`.includes(NODE_MODULES)) return null;
  return rel.split(sep).join("/");
}
function keyPath(path, roots) {
  if (path.includes(NODE_MODULES)) return null;
  const inside = roots.map((root2) => relative(root2, path)).find((rel2) => !rel2.startsWith(".."));
  const rel = inside ?? relative(roots[0], path);
  if (rel === "" || isAbsolute(rel)) return null;
  return rel.split(sep).join("/");
}
function packageRoot(path) {
  const at = path.lastIndexOf(NODE_MODULES);
  if (at < 0) return null;
  const start = at + NODE_MODULES.length;
  const parts = path.slice(start).split(sep);
  const name = parts[0]?.startsWith("@") ? parts.slice(0, 2) : parts.slice(0, 1);
  return path.slice(0, start) + name.join(sep);
}

// src/core/lint/provider/wraps.ts
import fs from "node:fs";
import { isAbsolute as isAbsolute2, resolve, sep as sep2 } from "node:path";
import { fileURLToPath as fileURLToPath2 } from "node:url";
import workerThreads from "node:worker_threads";
var LOADER = "node:internal/modules/";
var OWN = /* @__PURE__ */ new Set([import.meta.url, fileURLToPath2(import.meta.url)]);
function absolute(path) {
  if (path instanceof URL) return path.protocol === "file:" ? fileURLToPath2(path) : null;
  const text = Buffer.isBuffer(path) ? path.toString() : path;
  if (typeof text !== "string") return null;
  return isAbsolute2(text) ? text : resolve(text);
}
function callSites(below, limit) {
  const { prepareStackTrace, stackTraceLimit } = Error;
  const holder = {};
  try {
    Error.prepareStackTrace = (_, sites) => sites;
    Error.stackTraceLimit = limit;
    Error.captureStackTrace(holder, below);
    return holder.stack ?? [];
  } finally {
    Error.prepareStackTrace = prepareStackTrace;
    Error.stackTraceLimit = stackTraceLimit;
  }
}
function callerOf(below) {
  return callSites(below, 1)[0]?.getFileName() ?? "";
}
function loaderOpen(below) {
  const [read, caller] = callSites(below, 2);
  return read?.getFileName() === "node:fs" && read.getFunctionName() === "readFileSync" && (caller?.getFileName() ?? "").startsWith(LOADER);
}
function raw(options) {
  if (options === null || typeof options !== "object") return void 0;
  const { encoding: _, ...rest } = options;
  return rest;
}
function decoded(bytes, options) {
  const encoding = typeof options === "string" ? options : options?.encoding;
  if (typeof encoding !== "string" || encoding === "buffer") return bytes;
  return bytes.toString(encoding);
}
function wrapReads(observer2) {
  const { readFileSync: readFileSync4, readFile } = fs;
  const readAsync = fs.promises.readFile;
  const sync = function(...args) {
    const [path, options] = args;
    const file = absolute(path);
    if (file === null) return Reflect.apply(readFileSync4, this, args);
    const reader = callerOf(sync);
    const bytes = observer2.inside(() => Reflect.apply(readFileSync4, this, [path, raw(options)]));
    observer2.read(file, bytes, reader);
    return decoded(bytes, options);
  };
  const callback = function(...args) {
    const [path, options] = args;
    const done = args.at(-1);
    const file = absolute(path);
    if (file === null || typeof done !== "function") return Reflect.apply(readFile, this, args);
    const reader = callerOf(callback);
    const given = args.length > 2 ? options : void 0;
    const back = (error, bytes) => {
      if (error) return done(error);
      observer2.read(file, bytes, reader);
      done(null, decoded(bytes, given));
    };
    return Reflect.apply(readFile, this, [path, raw(given), back]);
  };
  const promised = async function(...args) {
    const [path, options] = args;
    const file = absolute(path);
    if (file === null) return Reflect.apply(readAsync, this, args);
    const reader = callerOf(promised);
    const bytes = await Reflect.apply(readAsync, this, [path, raw(options)]);
    observer2.read(file, bytes, reader);
    return decoded(bytes, options);
  };
  fs.readFileSync = sync;
  fs.readFile = callback;
  fs.promises.readFile = promised;
}
var WRITE_ONLY = /* @__PURE__ */ new Set(["w", "wx", "xw", "a", "ax", "xa", "as", "sa"]);
function reads(flags) {
  if (flags === void 0 || flags === null || typeof flags === "function") return true;
  if (typeof flags === "string") return !WRITE_ONLY.has(flags);
  return typeof flags === "number" && (flags & 3) !== fs.constants.O_WRONLY;
}
function wrapOpens(observer2) {
  const { openSync, open, createReadStream, openAsBlob } = fs;
  const openAsync = fs.promises.open;
  const flagged = (original) => {
    const wrapped = function(...args) {
      if (reads(args[1]) && !loaderOpen(wrapped)) observer2.opened(args[0]);
      return Reflect.apply(original, this, args);
    };
    return wrapped;
  };
  fs.openSync = flagged(openSync);
  fs.open = flagged(open);
  fs.promises.open = flagged(openAsync);
  fs.createReadStream = function(...args) {
    observer2.opened(args[0]);
    return Reflect.apply(createReadStream, this, args);
  };
  fs.openAsBlob = function(...args) {
    observer2.opened(args[0]);
    return Reflect.apply(openAsBlob, this, args);
  };
}
var STARTER_FRAMES = 32;
var ESLINT = /^(eslint|eslint9|@eslint\/.+)$/;
function wrapWorkers(observer2) {
  const { Worker } = workerThreads;
  const Watched = class extends Worker {
    constructor(...args) {
      super(...args);
      observer2.started(starterOf(callSites(Watched, STARTER_FRAMES)));
    }
  };
  workerThreads.Worker = Watched;
}
function starterOf(sites) {
  const names = [];
  let eslint = null;
  for (const site of sites) {
    const file = site.getFileName() ?? "";
    if (file === "" || file.startsWith("node:")) continue;
    if (OWN.has(file)) break;
    const name = packageOf(file);
    if (ESLINT.test(name)) eslint ??= name;
    else if (!names.includes(name)) names.push(name);
    if (names.length === 2) break;
  }
  return names.length > 0 ? names.join(", called by ") : eslint;
}
function packageOf(file) {
  const path = file.startsWith("file:") ? fileURLToPath2(file) : file;
  const parts = path.split(`${sep2}node_modules${sep2}`);
  if (parts.length < 2) return path;
  const [scope = path, name] = (parts.at(-1) ?? "").split(sep2);
  return scope.startsWith("@") && name !== void 0 ? `${scope}/${name}` : scope;
}

// src/core/lint/provider/observe.ts
var TYPESCRIPT = `${sep3}node_modules${sep3}typescript${sep3}`;
var Observer = class _Observer {
  constructor(roots, format2) {
    this.roots = roots;
    this.format = format2;
  }
  roots;
  format;
  /** Resolved module URLs and the file URLs of reads while a config loads, for `sortLoaded`. */
  urls = /* @__PURE__ */ new Set();
  files = /* @__PURE__ */ new Set();
  loads = 0;
  uses = /* @__PURE__ */ new Map();
  unobserved = /* @__PURE__ */ new Set();
  /** Paths whose uses changed since the last `delta`. */
  changed = /* @__PURE__ */ new Set();
  /** Inside a read: the file opens Node makes for it are the read's own (C3). */
  reading = 0;
  /** The module loader's last read, for a load hook given text: the blob of its bytes. */
  loaderRead = null;
  /** What started a worker thread in this thread, as a reason names it; `null` while nothing did (wave 1.8). */
  starter = null;
  /** Modules whose source the loader reads after the load hook. */
  pending = /* @__PURE__ */ new Map();
  /** Sets the hooks and the recorders in this thread; call once, before ESLint loads. */
  static install(root2, format2) {
    const observer2 = new _Observer([fs2.realpathSync(root2), root2], format2);
    registerHooks({
      resolve(specifier, context, nextResolve) {
        const result = nextResolve(specifier, context);
        observer2.module(result.url);
        return result;
      },
      load(url, context, nextLoad) {
        const result = nextLoad(url, context);
        observer2.loaded(url, result.source);
        return result;
      }
    });
    process.env.JITI_FS_CACHE = "false";
    wrapReads(observer2);
    wrapOpens(observer2);
    wrapWorkers(observer2);
    syncBuiltinESMExports();
    return observer2;
  }
  /** Runs `work`, a config load, with each file it reads recorded for `saw`. */
  async loading(work) {
    this.loads++;
    try {
      return await work();
    } finally {
      this.loads--;
    }
  }
  /** Whether the thread resolved or, loading a config, read `path`. */
  saw(path) {
    return this.files.has(path);
  }
  module(url) {
    this.urls.add(url);
    if (url.startsWith("file:")) this.files.add(fileURLToPath3(url.split("?")[0] ?? url));
  }
  /** A module's source as the load hook got it: bytes, or the text of the loader's read. */
  loaded(url, source) {
    const read = this.loaderRead;
    this.loaderRead = null;
    if (!url.startsWith("file:")) return;
    const query = url.indexOf("?");
    const path = keyPath(fileURLToPath3(query < 0 ? url : url.slice(0, query)), this.roots);
    if (path === null) return;
    const slot = query < 0 ? "module" : "module?";
    if (source instanceof Uint8Array) this.use(path, slot, blobHash(source, this.format));
    else if (source instanceof ArrayBuffer) {
      this.use(path, slot, blobHash(new Uint8Array(source), this.format));
    } else if (typeof source === "string" && read?.path === path) this.use(path, slot, read.blob);
    else if (source === null || source === void 0) this.pending.set(path, slot);
    else this.unobserve(path);
  }
  /** `bytes`, read from `file` by code in `reader`. */
  read(file, bytes, reader) {
    if (this.loads > 0) {
      this.files.add(file);
      this.urls.add(pathToFileURL(file).href);
    }
    const path = keyPath(file, this.roots);
    if (path === null || OWN.has(reader)) return;
    const blob = blobHash(bytes, this.format);
    if (reader.startsWith(LOADER)) {
      this.loaderRead = { path, blob };
      const slot = this.pending.get(path);
      this.pending.delete(path);
      if (slot !== void 0) this.use(path, slot, blob);
    } else this.use(path, reader.includes(TYPESCRIPT) ? "typescript" : `read ${reader}`, blob);
  }
  /** TypeScript's service was given `path`'s text, whose blob the pass read as `blob`. */
  gave(path, blob) {
    this.use(path, "typescript", blob);
  }
  /** ESLint code started a worker thread; `by` names it, `null` for the worker's own. */
  started(by) {
    if (by !== null) this.starter ??= by;
  }
  /**
   * Why nothing this thread lints can be stored any more (wave 1.8): ESLint
   * code started a worker thread, whose reads the observer does not see.
   * `null` while none did; a new thread starts clean.
   */
  get blind() {
    if (this.starter === null) return null;
    return `ESLint ran code in a worker thread Squeal cannot observe (${this.starter})`;
  }
  /** A file opened to be read some other way than whole: its bytes cannot be hashed. */
  opened(file) {
    if (this.reading > 0) return;
    const abs = absolute(file);
    const path = abs === null ? null : keyPath(abs, this.roots);
    if (path !== null) this.unobserve(path);
  }
  /** Each path whose uses changed since the last call, with what it holds now. */
  delta() {
    const out = [];
    for (const path of [...this.changed].sort()) out.push([path, this.heldOf(path)]);
    this.changed.clear();
    return out;
  }
  /** What the thread holds of `path`. */
  heldOf(path) {
    const uses = this.uses.get(path) ?? /* @__PURE__ */ new Map();
    const typescript = uses.get("typescript");
    const others = [...new Set([...uses].flatMap(([s, b]) => s === "typescript" ? [] : [b]))];
    return {
      ...typescript === void 0 ? {} : { typescript },
      others: others.sort(),
      ...this.unobserved.has(path) ? { unobserved: true } : {}
    };
  }
  /** Runs `read` as one read: the opens it makes are its own. */
  inside(read) {
    this.reading++;
    try {
      return read();
    } finally {
      this.reading--;
    }
  }
  use(path, slot, blob) {
    let uses = this.uses.get(path);
    if (uses === void 0) {
      uses = /* @__PURE__ */ new Map();
      this.uses.set(path, uses);
    }
    if (uses.get(slot) === blob) return;
    uses.set(slot, blob);
    this.changed.add(path);
  }
  unobserve(path) {
    if (this.unobserved.has(path)) return;
    this.unobserved.add(path);
    this.changed.add(path);
  }
};

// src/core/lint/provider/protocol.ts
var PROVIDER_VERSION = 4;
var ROOT_TOKEN = "<root>";
function firstLine(error) {
  const text = error instanceof Error ? error.message : String(error);
  return text.split("\n")[0]?.trim() ?? "";
}

// src/core/lint/provider/session.ts
import { readFileSync as readFileSync3, realpathSync as realpathSync2 } from "node:fs";
import { createRequire as createRequire2 } from "node:module";
import { join as join3, sep as sep5 } from "node:path";
import { pathToFileURL as pathToFileURL2 } from "node:url";

// src/core/lint/provider/program.ts
import {
  existsSync,
  globSync,
  readdirSync as readdirSync2,
  readFileSync as readFileSync2,
  realpathSync,
  statSync as statSync3
} from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, isAbsolute as isAbsolute3, join as join2, resolve as resolve2, sep as sep4 } from "node:path";

// src/core/lint/pass/state.ts
import {
  readdirSync,
  readFileSync,
  readlinkSync,
  statSync
} from "node:fs";
import { join } from "node:path";
function written(stat) {
  return `${stat.mtimeMs}:${stat.ctimeMs}:${stat.size}:${stat.ino}`;
}
function folderEntries(path) {
  let entries;
  try {
    entries = readdirSync(path, { withFileTypes: true });
  } catch {
    return null;
  }
  return entries.map((e) => {
    if (e.isSymbolicLink()) return `l ${e.name} ${linkOf(join(path, e.name))}`;
    return `${e.isDirectory() ? "d" : "f"} ${e.name}`;
  }).sort().join("\n");
}
function linkOf(path) {
  try {
    return readlinkSync(path);
  } catch {
    return "";
  }
}
function lookupRecord(state, read) {
  return `${state.startsWith("racy") ? "racy" : state}
${read}`;
}

// src/core/lint/provider/watch.ts
import { statSync as statSync2 } from "node:fs";
var Watch = class {
  constructor(now) {
    this.now = now;
  }
  now;
  states = /* @__PURE__ */ new Map();
  /** A folder's entries, for the folders among `states`. */
  entries = /* @__PURE__ */ new Map();
  readers = /* @__PURE__ */ new Map();
  stale = /* @__PURE__ */ new Set();
  /** Reads every watched path's state again; a change makes its results stale. */
  restat() {
    for (const [path, state] of this.states) {
      const now = stateOf(path, this.now);
      if (now === state) continue;
      this.states.set(path, now);
      const entries = folderEntries(path);
      if (entries !== null && entries === this.entries.get(path)) continue;
      this.record(path, entries);
      for (const result of this.readers.get(path) ?? []) this.stale.add(result);
    }
  }
  /** `result` was made now from `paths`, in place of one made from `before`. */
  made(result, paths, before = []) {
    for (const path of before) this.readers.get(path)?.delete(result);
    this.stale.delete(result);
    for (const path of paths) {
      if (!this.states.has(path)) {
        this.states.set(path, stateOf(path, this.now));
        this.record(path, folderEntries(path));
      }
      const readers = this.readers.get(path) ?? /* @__PURE__ */ new Set();
      readers.add(result);
      this.readers.set(path, readers);
    }
  }
  record(path, entries) {
    if (entries === null) this.entries.delete(path);
    else this.entries.set(path, entries);
  }
  /** Each path a kept result read, at the state and, for a folder, the entries last seen. */
  watched() {
    const out = /* @__PURE__ */ new Map();
    for (const [path, readers] of this.readers) {
      const state = this.states.get(path);
      const entries = this.entries.get(path) ?? null;
      if (readers.size > 0 && state !== void 0) out.set(path, { state, entries });
    }
    return out;
  }
  /** Whether `result` holds: no path it read changed state since it was made. */
  holds(result) {
    return !this.stale.has(result);
  }
};
var RACY_MS = 1e3;
var racy = 0;
function stateOf(path, now) {
  const stat = statSync2(path, { throwIfNoEntry: false });
  if (stat === void 0) return "missing";
  if (now() - Math.max(stat.mtimeMs, stat.ctimeMs) < RACY_MS) return `racy ${++racy}`;
  return written(stat);
}

// src/core/lint/provider/program.ts
function loadedTypeScript(packages) {
  const root2 = packages.find((p) => basename(p) === "typescript");
  if (root2 === void 0) return null;
  return createRequire(join2(root2, "package.json"))(root2);
}
function findTsconfigs(root2) {
  const found = [];
  const walk = (dir) => {
    for (const entry of readdirSync2(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (entry.name !== "node_modules" && !entry.name.startsWith("."))
          walk(join2(dir, entry.name));
      } else if (entry.name === "tsconfig.json") found.push(join2(dir, entry.name));
    }
  };
  walk(root2);
  return found.sort();
}
function namedTsconfigs(options, root2) {
  const base = typeof options.tsconfigRootDir === "string" ? options.tsconfigRootDir : root2;
  const named = Array.isArray(options.project) ? options.project : [options.project];
  return named.filter((p) => typeof p === "string").flatMap((p) => /[*?[{]/.test(p) ? globSync(p, { cwd: base }) : [p]).map((p) => isAbsolute3(p) ? p : resolve2(base, p)).sort();
}
function parseTsconfig(ts, path, readFile = sysText) {
  try {
    const host = { ...ts.sys, readFile, onUnRecoverableConfigFileDiagnostic: () => {
    } };
    const parsed = ts.getParsedCommandLineOfConfigFile(path, {}, host);
    if (parsed === void 0) return null;
    return {
      files: parsed.fileNames,
      extended: parsed.options.configFile?.extendedSourceFiles ?? [],
      options: parsed.options,
      ...parsed.wildcardDirectories ? { wildcardDirectories: parsed.wildcardDirectories } : {}
    };
  } catch {
    return null;
  }
}
function sameRoots(a, b) {
  const roots = (parsed) => [...parsed?.files ?? []].sort().join("\0");
  return roots(a) === roots(b);
}
var NODE_MODULES2 = `${sep4}node_modules${sep4}`;
var JAVASCRIPT = /\.[cm]?jsx?$/;
var JSDOC_IMPORT = /@import\s[^"'@]*?\bfrom\s*["']([^"'\n]+)["']|\bimport\(\s*["']([^"'\n]+)["']\s*\)/g;
var RECURSIVE = 1;
var ProgramReader = class {
  constructor(ts, root2, now = Date.now, format2 = "sha1") {
    this.ts = ts;
    this.root = root2;
    this.now = now;
    this.format = format2;
    this.watch = new Watch(now);
    this.host = { ...ts.sys, readFile: (path) => this.text(path, this.manifests) };
  }
  ts;
  root;
  now;
  format;
  specifiers = /* @__PURE__ */ new Map();
  /** By tsconfig, then file: two tsconfigs may resolve one file's names apart. */
  resolved = /* @__PURE__ */ new Map();
  parsed = /* @__PURE__ */ new Map();
  watch;
  paths = /* @__PURE__ */ new Map();
  /** TypeScript's system with the walk's own reads: TypeScript's service holds none of them (wave 1.7). */
  host;
  /** The blob of each file the walk's lookups last read, as a manifest. */
  manifests = /* @__PURE__ */ new Map();
  moved = false;
  /** The program of `tsconfigs`, as key paths: `../` above the root (wave 1.7 Q2). */
  read(tsconfigs) {
    this.watch.restat();
    const configs = /* @__PURE__ */ new Set();
    const files = /* @__PURE__ */ new Set();
    const walked = /* @__PURE__ */ new Map();
    for (const tsconfig of tsconfigs) {
      const parsed = this.parse(tsconfig);
      for (const [path, blob] of this.parsed.get(tsconfig)?.blobs ?? []) walked.set(path, blob);
      for (const path of [tsconfig, ...parsed?.extended ?? []]) {
        const rel = this.keyPath(path);
        if (rel !== null) configs.add(rel);
      }
      if (parsed === null) continue;
      for (const file of this.walk(tsconfig, parsed)) {
        const blob = this.specifiers.get(file)?.blob;
        if (blob !== void 0) walked.set(file, blob);
        const rel = this.keyPath(file);
        if (rel !== null) files.add(rel);
      }
    }
    const moved = this.moved;
    this.moved = false;
    const lookups = /* @__PURE__ */ new Map();
    for (const [path, { state, entries }] of this.watch.watched()) {
      const blob = this.manifests.get(path);
      lookups.set(path, lookupRecord(state, entries ?? (blob === void 0 ? "" : `#${blob}`)));
    }
    return { tsconfigs: [...configs].sort(), files: [...files].sort(), walked, lookups, moved };
  }
  /** A file's text as `ts.sys.readFile` gives it, its blob kept in `blobs`. */
  text(path, blobs) {
    const bytes = bytesOf(path);
    if (bytes === void 0) return void 0;
    blobs.set(path, blobHash(bytes, this.format));
    return textOf(bytes);
  }
  keyPath(path) {
    let rel = this.paths.get(path);
    if (rel === void 0) {
      rel = keyPath(path, [this.root]);
      this.paths.set(path, rel);
    }
    return rel;
  }
  parse(tsconfig) {
    const kept = this.parsed.get(tsconfig);
    if (kept !== void 0 && this.watch.holds(tsconfig)) return kept.parsed;
    const blobs = /* @__PURE__ */ new Map();
    const parsed = parseTsconfig(this.ts, tsconfig, (path) => this.text(path, blobs));
    for (const [path, blob] of blobs) this.manifests.set(path, blob);
    if (kept !== void 0 && !sameRoots(kept.parsed, parsed)) this.moved = true;
    const read = [tsconfig, ...parsed?.extended ?? [], ...globFolders(parsed)];
    this.watch.made(tsconfig, read, kept?.read);
    this.parsed.set(tsconfig, { parsed, read, blobs });
    return parsed;
  }
  /**
   * The root files and every file their imports, reference directives and
   * automatic types resolve to, followed outside `node_modules`: a
   * package's own imports are the install's (D5's packages).
   */
  walk(tsconfig, parsed) {
    const { ts } = this;
    const { options } = parsed;
    let cache = null;
    const resolver = {
      module: (name, file, mode) => {
        cache ??= ts.createModuleResolutionCache(dirname(tsconfig), (n) => n, options);
        const result = ts.resolveModuleName(name, file, options, this.host, cache, void 0, mode);
        return [result.resolvedModule?.resolvedFileName, result];
      },
      type: (name, file) => {
        const result = ts.resolveTypeReferenceDirective(name, file, options, this.host);
        return [result.resolvedTypeReferenceDirective?.resolvedFileName, result];
      },
      modes: this.modes(options)
    };
    const seen = new Set(parsed.files);
    const queue2 = [...parsed.files];
    const follow = (file) => {
      if (file === void 0 || seen.has(file) || file.includes(NODE_MODULES2)) return;
      seen.add(file);
      queue2.push(file);
    };
    const inferred = join2(dirname(tsconfig), "__inferred type names__.ts");
    for (const name of ts.getAutomaticTypeDirectiveNames(options, this.host)) {
      follow(resolver.type(name, inferred)[0]);
    }
    const resolved = this.resolved.get(tsconfig) ?? /* @__PURE__ */ new Map();
    this.resolved.set(tsconfig, resolved);
    for (let file = queue2.pop(); file !== void 0; file = queue2.pop()) {
      for (const target of this.targetsOf(tsconfig, file, resolver, resolved)) follow(target);
    }
    return seen;
  }
  /** Where `file`'s specifiers resolve: kept, unless its bytes or what its lookups read changed. */
  targetsOf(tsconfig, file, resolver, kept) {
    const specifiers = this.specifiersOf(file);
    if (specifiers === null) return [];
    const before = kept.get(file);
    const key = `${tsconfig}\0${file}`;
    if (before?.stamp === specifiers.stamp && !before.unsure && this.watch.holds(key)) {
      return before.targets;
    }
    const targets = [];
    const names = /* @__PURE__ */ new Map();
    const watched = /* @__PURE__ */ new Set();
    let unsure = false;
    const found = (name, [target, lookups]) => {
      const failed = lookups.failedLookupLocations;
      if (target === void 0 && failed === void 0) unsure = true;
      for (const path of [...failed ?? [], ...target ? [target] : []]) {
        if (!path.includes(NODE_MODULES2)) watched.add(dirname(path));
      }
      for (const path of lookups.affectingLocations ?? []) {
        if (!path.includes(NODE_MODULES2)) watched.add(path);
      }
      names.set(name, target ?? "");
      if (target !== void 0) targets.push(target);
    };
    for (const name of specifiers.modules) {
      for (const mode of resolver.modes)
        found(`${mode} ${name}`, resolver.module(name, file, mode));
    }
    for (const name of specifiers.types) found(`types ${name}`, resolver.type(name, file));
    for (const path of specifiers.paths) {
      const target = referenced(resolve2(dirname(file), path));
      watched.add(dirname(resolve2(dirname(file), path)));
      names.set(`path ${path}`, target ?? "");
      if (target !== void 0) targets.push(target);
    }
    for (const [name, target] of before?.names ?? []) {
      if ((names.get(name) ?? target) !== target) this.moved = true;
    }
    this.watch.made(key, watched, before?.read);
    kept.set(file, { stamp: specifiers.stamp, targets, names, read: [...watched], unsure });
    return targets;
  }
  /**
   * Both import modes where the resolution kind reads them (Node16,
   * NodeNext, Bundler): the walk does not tell an `import` from a
   * `require`, so it takes the files either resolves to.
   */
  modes(options) {
    const { ModuleKind, ModuleResolutionKind } = this.ts;
    const kind = this.ts.getEmitModuleResolutionKind?.(options);
    return kind === ModuleResolutionKind.Classic || kind === ModuleResolutionKind.Node10 ? [void 0] : [ModuleKind.ESNext, ModuleKind.CommonJS];
  }
  /** `file`'s specifiers, read again when its stat changed; `null` when it cannot be read. */
  specifiersOf(file) {
    const stamp = stateOf(file, this.now);
    const kept = this.specifiers.get(file);
    if (kept?.stamp === stamp) return kept;
    const bytes = bytesOf(file);
    if (bytes === void 0) {
      this.specifiers.delete(file);
      return null;
    }
    const text = bytes.toString("utf8");
    const javascript = JAVASCRIPT.test(file);
    const info = this.ts.preProcessFile(text, true, javascript);
    const modules = info.importedFiles.map((f) => f.fileName);
    if (javascript) {
      for (const match of text.matchAll(JSDOC_IMPORT)) modules.push(match[1] ?? match[2] ?? "");
    }
    const specifiers = {
      stamp,
      blob: blobHash(bytes, this.format),
      modules: [...new Set(modules)],
      paths: info.referencedFiles.map((f) => f.fileName),
      types: info.typeReferenceDirectives.map((f) => f.fileName)
    };
    this.specifiers.set(file, specifiers);
    return specifiers;
  }
};
function globFolders(parsed) {
  const out = [];
  const links = /* @__PURE__ */ new Set();
  const visit = (dir, recursive) => {
    out.push(dir);
    if (!recursive) return;
    let entries;
    try {
      entries = readdirSync2(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const path = join2(dir, entry.name);
      if (entry.isDirectory()) visit(path, true);
      else if (entry.isSymbolicLink() && statSync3(path, { throwIfNoEntry: false })?.isDirectory()) {
        const real = realpathSync(path);
        if (links.has(real)) continue;
        links.add(real);
        visit(path, true);
      }
    }
  };
  for (const [dir, flags] of Object.entries(parsed?.wildcardDirectories ?? {})) {
    visit(dir, (flags & RECURSIVE) !== 0);
  }
  return out;
}
function referenced(path) {
  return [path, `${path}.ts`, `${path}.tsx`, `${path}.d.ts`].find((p) => existsSync(p));
}
function bytesOf(path) {
  try {
    return readFileSync2(path);
  } catch {
    return void 0;
  }
}
function textOf(bytes) {
  if (bytes[0] === 254 && bytes[1] === 255) {
    const even = bytes.subarray(2, 2 + (bytes.length - 2 & ~1));
    return Buffer.from(even).swap16().toString("utf16le");
  }
  if (bytes[0] === 255 && bytes[1] === 254) return bytes.toString("utf16le", 2);
  if (bytes[0] === 239 && bytes[1] === 187 && bytes[2] === 191) return bytes.toString("utf8", 3);
  return bytes.toString("utf8");
}
function sysText(path) {
  const bytes = bytesOf(path);
  return bytes === void 0 ? void 0 : textOf(bytes);
}

// src/core/lint/provider/signals.ts
var CROSS_FILE_PLUGINS = /* @__PURE__ */ new Set([
  "eslint-plugin-import",
  "eslint-plugin-import-x"
]);
var CROSS_FILE_NAMESPACES = /* @__PURE__ */ new Set(["import", "import-x"]);
function lintSignals(config) {
  const options = config.languageOptions?.parserOptions ?? {};
  const typed2 = Boolean(options.project || options.projectService || options.programs);
  const crossSpaces = new Set(CROSS_FILE_NAMESPACES);
  for (const entry of config.plugins ?? []) {
    const colon = entry.indexOf(":");
    if (colon < 0) continue;
    const named = entry.slice(colon + 1);
    const at = named.lastIndexOf("@");
    if (CROSS_FILE_PLUGINS.has(at > 0 ? named.slice(0, at) : named)) {
      crossSpaces.add(entry.slice(0, colon));
    }
  }
  const crossFile = Object.entries(config.rules ?? {}).some(([id, setting]) => {
    const slash = id.lastIndexOf("/");
    return slash > 0 && crossSpaces.has(id.slice(0, slash)) && enabled(setting);
  });
  return { typed: typed2, crossFile };
}
function enabled(setting) {
  const severity = Array.isArray(setting) ? setting[0] : setting;
  return severity !== 0 && severity !== "off" && severity !== void 0;
}

// src/core/lint/provider/session.ts
var KEYED_ENV = ["ESLINT_USE_FLAT_CONFIG", "TSESTREE_SINGLE_RUN"];
var PROBE = "squeal-config-probe.js";
var ConfigError = class extends Error {
};
var Unobserved = class extends Error {
};
var EslintSession = class _EslintSession {
  constructor(given, root2, version, ESLint, observer2, format2) {
    this.given = given;
    this.root = root2;
    this.version = version;
    this.ESLint = ESLint;
    this.observer = observer2;
    this.format = format2;
    this.eslint = new ESLint({ cwd: root2 });
  }
  given;
  root;
  version;
  ESLint;
  observer;
  format;
  eslint;
  /** The tsconfigs typed configs read; found once per instance. */
  relevant = null;
  program = { tsconfigs: [], files: [] };
  reader = null;
  /** Program files and tsconfigs learned from a lint, kept for the thread's life. */
  learned = { tsconfigs: /* @__PURE__ */ new Set(), files: /* @__PURE__ */ new Set() };
  /** A typed config, to feed a program file ESLint does not lint. */
  feeder = null;
  /** Each config file ESLint used, its load seen: in the closure for the thread's life. */
  configs = /* @__PURE__ */ new Set();
  /** The walk's reads and lookups as the host was last told them (wave 1.7). */
  told = {
    walked: /* @__PURE__ */ new Map(),
    lookups: /* @__PURE__ */ new Map()
  };
  /** D3 discovery; `off` with D9's reason. */
  static async open(given, observer2, format2 = "sha1") {
    const root2 = realpathSync2(given);
    const require2 = createRequire2(join3(root2, "package.json"));
    let manifest;
    try {
      manifest = require2.resolve("eslint/package.json");
    } catch {
      return { off: `no ESLint installed in ${given}` };
    }
    const version = String(JSON.parse(readFileSync3(manifest, "utf8")).version);
    const major = Number.parseInt(version, 10);
    if (major !== 9 && major !== 10) return { off: `ESLint ${major} is not supported` };
    const api = await import(pathToFileURL2(require2.resolve("eslint")).href);
    const ESLint = api.loadESLint ? await api.loadESLint({ cwd: root2 }) : api.ESLint;
    if (ESLint.configType !== void 0 && ESLint.configType !== "flat") {
      return { off: "eslintrc configs are not supported; ESLint 9 and 10 read eslint.config.*" };
    }
    return new _EslintSession(given, root2, version, ESLint, observer2, format2);
  }
  async declaration() {
    const config = await this.eslint.findConfigFile().catch(() => void 0);
    const rel = config === void 0 ? null : projectPath(config, this.root);
    return {
      tool: "eslint",
      toolVersion: this.version,
      providerVersion: PROVIDER_VERSION,
      configFiles: rel === null ? [] : [rel]
    };
  }
  /** D4 `instance`: a new `ESLint`, which imports the config again. */
  fresh() {
    this.eslint = new this.ESLint({ cwd: this.root });
    this.relevant = null;
    this.feeder = null;
  }
  /**
   * Loads the config and reads the program again; a config that does not
   * load is told by `inputs` and `lint`. `moved` when a name the program
   * kept resolves to another file (Q1) or a tsconfig's root files changed.
   * Throws `Unobserved`.
   */
  async refreshed() {
    await this.computed(join3(this.root, PROBE)).catch((error) => {
      if (error instanceof Unobserved) throw error;
    });
    const ts = loadedTypeScript(sortLoaded(this.observer.urls, this.root).packages);
    if (ts !== null) {
      this.relevant ??= await this.typedTsconfigs(ts);
      if (this.reader?.ts !== ts) {
        this.reader = new ProgramReader(ts, this.root, Date.now, this.format);
      }
      this.program = this.reader.read(this.relevant);
    }
    return { env: this.environment(), moved: this.program.moved === true };
  }
  /**
   * What changed since the last call (wave 1.7 W3): what the thread holds
   * of each path it used since, and the walk's reads and lookups.
   */
  delta() {
    const told = (sent, now) => {
      const fresh = /* @__PURE__ */ new Map();
      for (const [path, value] of now) {
        const rel = keyPath(path, [this.root, this.given]);
        if (rel !== null) fresh.set(rel, value);
      }
      const out = [];
      for (const [path, value] of fresh) if (sent.get(path) !== value) out.push([path, value]);
      for (const path of sent.keys()) if (!fresh.has(path)) out.push([path, null]);
      sent.clear();
      for (const [path, value] of fresh) sent.set(path, value);
      return out;
    };
    return {
      held: this.observer.delta(),
      walked: told(this.told.walked, this.program.walked ?? /* @__PURE__ */ new Map()),
      lookups: told(this.told.lookups, this.program.lookups ?? /* @__PURE__ */ new Map())
    };
  }
  environment() {
    const sets = sortLoaded(this.observer.urls, this.root);
    const env = {};
    for (const name of KEYED_ENV) {
      const value = process.env[name];
      if (value !== void 0) env[name] = value;
    }
    const configs = [...this.configs].flatMap((file) => this.keyPath(file) ?? []);
    return {
      closure: union(sets.closure, configs, this.program.tsconfigs, this.learned.tsconfigs),
      packages: sets.packages,
      program: union(this.program.files, this.learned.files),
      env
    };
  }
  async inputs(paths, progress) {
    const out = [];
    for (const path of paths) {
      const config = await this.configOf(path);
      progress();
      if (typeof config === "string") throw new ConfigError(config);
      if (config === void 0) continue;
      const json = this.rootless(JSON.stringify(config));
      const signals = lintSignals(JSON.parse(json));
      out.push([path, { config: json, wholeProgram: signals.typed || signals.crossFile }]);
    }
    return out;
  }
  /**
   * Lints `files` with the kept instance. Typed files and the program files
   * ESLint does not lint are fed to TypeScript's project service first, so
   * each typed file reads the call's text of the others (D5 step 1); a fed
   * file ESLint does not lint gets no result.
   */
  async lint(files, progress) {
    const results = [];
    const told = (path, result) => results.push([path, result]);
    const linted = [];
    const feed = [];
    for (const file of files) {
      const config = await this.configOf(file.path);
      if (typeof config === "string") told(file.path, { unknown: config });
      else if (config !== void 0) {
        linted.push(file);
        if (typed(config)) {
          this.feeder ??= config;
          feed.push({ file, config, lints: true });
        }
      } else if (this.inProgram(file.path) && this.feeder !== null) {
        feed.push({ file, config: this.feeder, lints: false });
      } else told(file.path, { unknown: "ESLint does not lint this file" });
    }
    const alone = feed.length === 1 && feed[0]?.lints === true;
    const feeding = !alone ? feed : feed.filter(({ file }) => !this.inProgram(file.path));
    for (const { file, config } of feeding) {
      this.learn(this.parse(file, config));
      this.gave(file);
      progress();
    }
    const typedFiles = new Set(feed.filter((f) => f.lints).map(({ file }) => file));
    for (const file of linted) {
      told(file.path, await this.lintOne(file));
      if (typedFiles.has(file)) this.gave(file);
      progress();
    }
    const blind = this.observer.blind;
    if (blind === null) return results;
    return results.map(([path, result]) => [
      path,
      "unknown" in result ? result : { unknown: blind }
    ]);
  }
  /** TypeScript's service holds `file`'s text now, at the blob the pass read it at (wave 1.7). */
  gave(file) {
    if (file.blob !== void 0) this.observer.gave(file.path, file.blob);
  }
  async lintOne(file) {
    let results;
    try {
      results = await this.eslint.lintText(file.text, {
        filePath: join3(this.root, file.path),
        warnIgnored: false
      });
    } catch (error) {
      return { unknown: `ESLint failed on this file: ${firstLine(error)}` };
    }
    const result = results[0];
    if (result === void 0) return { unknown: "ESLint does not lint this file" };
    return { messages: result.messages.map(message) };
  }
  /**
   * The file's computed config; `undefined` when ESLint does not lint it;
   * D9's reason when the config does not load. Throws `Unobserved`.
   */
  async configOf(path) {
    const abs = join3(this.root, path);
    try {
      return await this.computed(abs);
    } catch (error) {
      if (error instanceof Unobserved) throw error;
      if (noConfig(error)) return void 0;
      const config = await this.eslint.findConfigFile(abs).catch(() => void 0);
      const name = (config && projectPath(config, this.root)) ?? "eslint.config.js";
      return `${name} does not load: ${firstLine(error)}`;
    }
  }
  /**
   * `calculateConfigForFile` with its config's load observed (D4). The
   * config file joins the closure, as ESLint's own name for it: one whose
   * load the worker did not see throws `Unobserved`.
   */
  async computed(abs) {
    const config = await this.observer.loading(() => this.eslint.calculateConfigForFile(abs));
    const file = await this.eslint.findConfigFile(abs).catch(() => void 0);
    if (file !== void 0 && !this.configs.has(file)) {
      if (!this.observer.saw(file)) {
        const name = projectPath(file, this.root) ?? file;
        throw new Unobserved(`the ESLint worker cannot see which files ${name} loads`);
      }
      this.configs.add(file);
    }
    return config;
  }
  async typedTsconfigs(ts) {
    const found = /* @__PURE__ */ new Set();
    for (const tsconfig of findTsconfigs(this.root)) {
      for (const file of parseTsconfig(ts, tsconfig)?.files ?? []) {
        const path = projectPath(file, this.root);
        const config = path === null ? void 0 : await this.configOf(path);
        if (typeof config !== "object" || !typed(config)) continue;
        this.feeder ??= config;
        const options = config.languageOptions?.parserOptions ?? {};
        const named = typeof options.project === "string" || Array.isArray(options.project);
        for (const one of named ? namedTsconfigs(options, this.root) : [tsconfig]) found.add(one);
        break;
      }
    }
    return [...found].sort();
  }
  parse(file, config) {
    const options = config.languageOptions;
    try {
      return options?.parser?.parseForESLint?.(file.text, {
        ...options.parserOptions,
        ecmaVersion: options.ecmaVersion,
        sourceType: options.sourceType,
        filePath: join3(this.root, file.path)
      }).services?.program;
    } catch {
      return void 0;
    }
  }
  learn(program) {
    if (program === void 0) return;
    for (const source of program.getSourceFiles()) {
      const rel = this.keyPath(source.fileName);
      if (rel !== null) this.learned.files.add(rel);
    }
    const options = program.getCompilerOptions();
    const configs = [options.configFilePath, ...options.configFile?.extendedSourceFiles ?? []];
    for (const config of configs) {
      const rel = typeof config === "string" ? this.keyPath(config) : null;
      if (rel !== null) this.learned.tsconfigs.add(rel);
    }
  }
  /** A path as keys hold it, `../` above the root (wave 1.7 Q2). */
  keyPath(path) {
    return keyPath(path, [this.root, this.given]);
  }
  inProgram(path) {
    return this.program.files.includes(path) || this.learned.files.has(path);
  }
  /** The config's JSON with the project root written `<root>` (goal 7). */
  rootless(json) {
    let out = json;
    for (const root2 of /* @__PURE__ */ new Set([this.root, this.given])) {
      out = out.split(JSON.stringify(root2 + sep5).slice(1, -1)).join(`${ROOT_TOKEN}/`);
      out = out.split(JSON.stringify(root2).slice(1, -1)).join(ROOT_TOKEN);
    }
    return out;
  }
};
function typed(config) {
  return lintSignals({
    languageOptions: { parserOptions: config.languageOptions?.parserOptions ?? {} }
  }).typed;
}
function noConfig(error) {
  const template = error?.messageTemplate;
  return template === "config-file-missing" || firstLine(error).startsWith("Could not find config file");
}
function message(m) {
  return {
    ruleId: m.ruleId,
    severity: m.severity,
    message: m.message,
    ...m.line === void 0 ? {} : { line: m.line },
    ...m.column === void 0 ? {} : { column: m.column }
  };
}
function union(...sets) {
  return [...new Set(sets.flatMap((s) => [...s]))].sort();
}

// src/core/lint/provider/worker.ts
var port = parentPort;
var { root, format } = workerData;
var observer = Observer.install(root, format);
var session = null;
var queue = Promise.resolve();
var send = (message2) => port?.postMessage(message2);
port?.on("message", (message2) => {
  queue = queue.then(() => handle(message2));
});
async function handle(message2) {
  try {
    const answer = await answerOf(message2);
    await new Promise((resolve3) => setTimeout(resolve3, 0));
    send({ type: "done", id: message2.id, answer });
  } catch (error) {
    send({ type: "error", id: message2.id, message: firstLine(error) });
  }
}
async function answerOf(message2) {
  try {
    return await answered(message2);
  } catch (error) {
    if (error instanceof Unobserved) return { type: "off", reason: error.message };
    throw error;
  }
}
async function answered(message2) {
  const progress = () => send({ type: "progress", id: message2.id });
  if (message2.type === "open") {
    const opened = await EslintSession.open(root, observer, format);
    if ("off" in opened) return { type: "off", reason: opened.off };
    session = opened;
    return { type: "open", declaration: await opened.declaration() };
  }
  if (session === null) throw new Error("the ESLint worker was not opened");
  if (message2.type === "refresh") {
    if (message2.fresh) session.fresh();
    const { env, moved } = await session.refreshed();
    const declaration = await session.declaration();
    return {
      type: "snapshot",
      declaration,
      env,
      delta: session.delta(),
      ...moved ? { moved } : {}
    };
  }
  if (message2.type === "inputs") {
    return { type: "inputs", inputs: await session.inputs(message2.paths, progress) };
  }
  const results = await session.lint(message2.files, progress);
  return { type: "linted", results, env: session.environment(), delta: session.delta() };
}
