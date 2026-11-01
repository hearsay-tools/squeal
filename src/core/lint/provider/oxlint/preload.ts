import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/*
 * Spec 017 D11 "Key": a `node --import` preload in the oxlint process. It
 * records the bytes oxlint's JavaScript side used: every module it loaded
 * and every file it read, as git blobs of the raw bytes, as D5's held
 * bytes. A read-capable open marks its path unobserved. It names what
 * started a worker thread or a process, and an uncaught exception (D11's
 * `unknown` cases). Its report is written at exit to `SQUEAL_OXLINT_OBSERVE`.
 * The Rust side's reads it cannot see (`research/oxlint-provider.md` Q2).
 *
 * Reads and starts made by oxlint's own package are its own: its binding's
 * loader reads `/usr/bin/ldd` and may run `ldd --version`. Plain
 * JavaScript, so it runs from a private temp folder with no build step.
 */

/** What the preload writes: absolute paths. */
export interface PreloadReport {
  /** Each path read or loaded, with the blob of each distinct use's bytes. */
  readonly reads: readonly (readonly [string, readonly string[]])[];
  readonly unobserved: readonly string[];
  /** The first worker thread or process started, as `a worker thread by <file>`. */
  readonly started: string | null;
  readonly uncaught: string | null;
}

export const PRELOAD_SOURCE = String.raw`
import fs from "node:fs";
import childProcess from "node:child_process";
import { createHash } from "node:crypto";
import { registerHooks, syncBuiltinESMExports } from "node:module";
import { resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import workerThreads from "node:worker_threads";

const out = process.env.SQUEAL_OXLINT_OBSERVE;
const format = process.env.SQUEAL_OXLINT_FORMAT === "sha256" ? "sha256" : "sha1";
const tool = process.env.SQUEAL_OXLINT_PACKAGE ? process.env.SQUEAL_OXLINT_PACKAGE + sep : null;
const self = import.meta.url;
const original = { readFileSync: fs.readFileSync, writeFileSync: fs.writeFileSync };
const reads = new Map();
const unobserved = new Set();
let started = null;
let uncaught = null;
let own = 0;

const blob = (bytes) => createHash(format).update("blob " + bytes.byteLength + "\0").update(bytes).digest("hex");
const pathOf = (p) => {
  try {
    if (typeof p === "string") return resolve(p.startsWith("file:") ? fileURLToPath(p) : p);
    if (p instanceof URL) return fileURLToPath(p);
    if (Buffer.isBuffer(p)) return resolve(p.toString());
  } catch {}
  return null;
};
const caller = () => {
  const saved = Error.prepareStackTrace;
  Error.prepareStackTrace = (_, frames) => frames;
  const frames = new Error().stack;
  Error.prepareStackTrace = saved;
  for (const frame of Array.isArray(frames) ? frames : []) {
    const name = frame.getFileName();
    if (!name || name === self || name.startsWith("node:")) continue;
    return name.startsWith("file:") ? fileURLToPath(name) : name;
  }
  return null;
};
const toolOwn = () => {
  const file = caller();
  return tool !== null && file !== null && file.startsWith(tool);
};
const held = (path, bytes) => {
  let set = reads.get(path);
  if (set === undefined) reads.set(path, (set = new Set()));
  set.add(blob(bytes));
};
const readable = (flags) => {
  if (flags === undefined || flags === null) return true;
  if (typeof flags === "number") return (flags & 3) !== fs.constants.O_WRONLY;
  return /[r+]/.test(String(flags));
};
const encodingOf = (options) => (typeof options === "string" ? options : options?.encoding ?? null);
const raw = (options) => (typeof options === "object" && options !== null ? { ...options, encoding: null } : null);
const decode = (bytes, encoding) => (encoding ? bytes.toString(encoding) : bytes);

registerHooks({
  load(url, context, nextLoad) {
    own++;
    let result;
    try {
      result = nextLoad(url, context);
    } finally {
      own--;
    }
    if (url.startsWith("file:")) {
      const path = fileURLToPath(url);
      if (result.source === null || result.source === undefined) {
        own++;
        try { held(path, original.readFileSync(path)); } catch { unobserved.add(path); } finally { own--; }
      } else held(path, typeof result.source === "string" ? Buffer.from(result.source) : result.source);
    }
    return result;
  },
});

const readFileSync = fs.readFileSync;
fs.readFileSync = function (p, options) {
  if (own > 0) return readFileSync.call(this, p, options);
  const path = pathOf(p);
  if (path === null || toolOwn()) return readFileSync.call(this, p, options);
  // Node's readFileSync opens through the public openSync: that open is this read's own.
  own++;
  let bytes;
  try {
    bytes = readFileSync.call(this, p, raw(options));
  } finally {
    own--;
  }
  held(path, bytes);
  return decode(bytes, encodingOf(options));
};
const readFile = fs.readFile;
fs.readFile = function (p, options, callback) {
  if (typeof options === "function") [options, callback] = [null, options];
  const path = own > 0 || toolOwn() ? null : pathOf(p);
  if (path === null) return readFile.call(this, p, options ?? {}, callback);
  own++;
  try {
    return readFile.call(this, p, raw(options) ?? {}, (error, bytes) => {
      if (error) return callback(error);
      held(path, bytes);
      callback(null, decode(bytes, encodingOf(options)));
    });
  } finally {
    own--;
  }
};
const promisesReadFile = fs.promises.readFile;
fs.promises.readFile = async function (p, options) {
  const path = own > 0 || toolOwn() ? null : pathOf(p);
  if (path === null) return promisesReadFile.call(this, p, options);
  own++;
  let pending;
  try {
    pending = promisesReadFile.call(this, p, raw(options));
  } finally {
    own--;
  }
  const bytes = await pending;
  held(path, bytes);
  return decode(bytes, encodingOf(options));
};
const opens = [
  [fs, "openSync", (args) => args[1]],
  [fs, "open", (args) => (typeof args[1] === "function" ? undefined : args[1])],
  [fs.promises, "open", (args) => args[1]],
  [fs, "createReadStream", () => "r"],
];
for (const [target, name, flagsOf] of opens) {
  const open = target[name];
  target[name] = function (...args) {
    if (own === 0 && readable(flagsOf(args)) && !toolOwn()) {
      const path = pathOf(args[0]);
      if (path !== null) unobserved.add(path);
    }
    return open.apply(this, args);
  };
}

const start = (what) => {
  if (started === null && !toolOwn()) started = what + " by " + (caller() ?? "an unknown module");
};
const Worker = workerThreads.Worker;
workerThreads.Worker = class extends Worker {
  constructor(...args) {
    start("a worker thread");
    super(...args);
  }
};
for (const name of ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"]) {
  const run = childProcess[name];
  childProcess[name] = function (...args) {
    start("a process");
    return run.apply(this, args);
  };
}
syncBuiltinESMExports();

process.on("uncaughtExceptionMonitor", (error) => {
  uncaught ??= String(error && error.message !== undefined ? error.message : error).split("\n")[0];
});
process.on("exit", () => {
  if (!out) return;
  const list = [...reads].map(([path, blobs]) => [path, [...blobs]]);
  original.writeFileSync(out, JSON.stringify({ reads: list, unobserved: [...unobserved], started, uncaught }));
});
`;

/** The preload written to a private temp folder, and the folder for each run's report. */
export class Preload {
  readonly path: string;
  private readonly dir: string;
  private runs = 0;

  constructor() {
    this.dir = mkdtempSync(join(tmpdir(), "squeal-oxlint-"));
    this.path = join(this.dir, "preload.mjs");
    writeFileSync(this.path, PRELOAD_SOURCE);
  }

  /** A fresh report path for one run. */
  reportPath(): string {
    this.runs += 1;
    return join(this.dir, `report-${this.runs}.json`);
  }

  /** The run's report, removed once read; `null` when the run wrote none. */
  read(path: string): PreloadReport | null {
    try {
      return JSON.parse(readFileSync(path, "utf8")) as PreloadReport;
    } catch {
      return null;
    } finally {
      rmSync(path, { force: true });
    }
  }

  remove(): void {
    rmSync(this.dir, { recursive: true, force: true });
  }
}
