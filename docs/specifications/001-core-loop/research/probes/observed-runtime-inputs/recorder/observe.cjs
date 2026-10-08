// THROWAWAY probe (research observed-runtime-inputs). Not product code.
// Loaded with --require. Records, per process, every path the process reads,
// stats, lists or writes through `fs`, every module Node resolves (registerHooks),
// and every child it spawns; injects itself into every child's env, whatever env
// the caller passed (also `env: {}` and allowlisted envs).
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const cp = require("node:child_process");
const mod = require("node:module");
const { isInternalThread, threadId } = require("node:worker_threads");
const { fileURLToPath } = require("node:url");

const OUT = process.env.SQUEAL_OBSERVE_DIR;
const SELF = __filename;
if (OUT && !isInternalThread && !globalThis.__squealObserve) {
  globalThis.__squealObserve = true;
  const file = path.join(OUT, `obs-${process.pid}-${threadId}.ndjson`);
  const seen = new Set();
  const raw = { appendFileSync: fs.appendFileSync };
  const current = () => globalThis.__vitest_worker__?.filepath ?? process.env.SQUEAL_OBSERVE_TEST ?? null;
  let writing = false;
  const emit = (kind, p, extra) => {
    if (writing || typeof p !== "string" && !(p instanceof URL) && !Buffer.isBuffer(p)) return;
    let abs;
    try { abs = p instanceof URL ? fileURLToPath(p) : path.resolve(String(p)); } catch { return; }
    if (abs.startsWith(OUT)) return;
    const test = current();
    const key = `${kind}\0${abs}\0${test}`;
    if (seen.has(key) && !extra) return;
    seen.add(key);
    writing = true;
    try { raw.appendFileSync(file, JSON.stringify({ pid: process.pid, ppid: process.ppid, tid: threadId, test, kind, path: abs, ...extra }) + "\n"); }
    finally { writing = false; }
  };
  const wrap = (obj, name, kind, argIndex = 0) => {
    const orig = obj[name];
    if (typeof orig !== "function") return;
    obj[name] = function (...args) { emit(kind, args[argIndex]); return orig.apply(this, args); };
    Object.defineProperties(obj[name], Object.getOwnPropertyDescriptors(orig));
  };
  const isWriteFlag = (f) => typeof f === "string" && /[wa+]/.test(f) || typeof f === "number" && (f & 3) !== 0;
  for (const n of ["readFileSync", "readFile", "createReadStream", "readdirSync", "readdir", "opendirSync", "opendir"]) wrap(fs, n, n.startsWith("read") && n.includes("dir") || n.startsWith("opendir") ? "list" : "read");
  for (const n of ["statSync", "lstatSync", "stat", "lstat", "existsSync", "exists", "accessSync", "access", "realpathSync", "realpath"]) wrap(fs, n, "stat");
  for (const n of ["writeFileSync", "writeFile", "appendFileSync", "appendFile", "createWriteStream", "mkdirSync", "mkdir", "rmSync", "rm", "unlinkSync", "unlink"]) wrap(fs, n, "write");
  for (const n of ["copyFileSync", "copyFile", "cpSync", "cp"]) { wrap(fs, n, "read", 0); }
  for (const n of ["openSync", "open"]) {
    const orig = fs[n];
    fs[n] = function (p, flags, ...rest) { emit(isWriteFlag(flags) ? "write" : "read", p); return orig.call(this, p, flags, ...rest); };
  }
  const fsp = fs.promises;
  for (const n of ["readFile", "readdir", "opendir"]) wrap(fsp, n, n === "readFile" ? "read" : "list");
  for (const n of ["stat", "lstat", "access", "realpath"]) wrap(fsp, n, "stat");
  for (const n of ["writeFile", "appendFile", "mkdir", "rm", "unlink"]) wrap(fsp, n, "write");
  { const orig = fsp.open; fsp.open = function (p, flags, ...rest) { emit(isWriteFlag(flags) ? "write" : "read", p); return orig.call(this, p, flags, ...rest); }; }

  // children: inject NODE_OPTIONS --require <self> and the output dir into whatever env is passed
  const inject = (env) => {
    if (process.env.SQUEAL_OBSERVE_NOINJECT) return env;
    const base = env ?? process.env;
    const opts = base.NODE_OPTIONS ?? "";
    const req = `--require ${JSON.stringify(SELF)}`;
    const test = current();
    return { ...base, SQUEAL_OBSERVE_DIR: OUT, ...(test ? { SQUEAL_OBSERVE_TEST: test } : {}), NODE_OPTIONS: opts.includes(SELF) ? opts : `${req} ${opts}`.trim() };
  };
  const proto = cp.ChildProcess.prototype;
  const origSpawn = proto.spawn;
  proto.spawn = function (options) {
    const env = {};
    for (const pair of options.envPairs ?? []) { const i = pair.indexOf("="); env[pair.slice(0, i)] = pair.slice(i + 1); }
    options.envPairs = Object.entries(inject(env)).map(([k, v]) => `${k}=${v}`);
    const r = origSpawn.call(this, options);
    emit("spawn", options.file, { child: this.pid ?? null, argv: options.args });
    for (const a of options.args ?? []) if (typeof a === "string" && a.startsWith("/") ) { try { if (fs.statSync(a).isFile()) emit("argv", a); } catch {} }
    return r;
  };
  for (const n of ["spawnSync", "execSync", "execFileSync"]) {
    const orig = cp[n];
    cp[n] = function (...args) {
      let i = args.findIndex((a, k) => k > 0 && a && typeof a === "object" && !Array.isArray(a));
      if (i < 0) { i = args.length; args.push({}); }
      args[i] = { ...args[i], env: inject(args[i].env) };
      emit("spawn", args[0], { sync: true });
      return orig.apply(this, args);
    };
  }
  // worker threads: the --require preload runs in them; carry the test file into their env
  const wt = require("node:worker_threads");
  const OrigWorker = wt.Worker;
  wt.Worker = class extends OrigWorker {
    constructor(filename, options = {}) {
      const test = current();
      super(filename, test && options.env !== wt.SHARE_ENV ? { ...options, env: { ...(options.env ?? process.env), SQUEAL_OBSERVE_TEST: test } } : options);
    }
  };
  mod.syncBuiltinESMExports();

  if (typeof mod.registerHooks === "function") {
    mod.registerHooks({
      resolve(specifier, context, next) {
        const r = next(specifier, context);
        if (r.url.startsWith("file:")) emit("module", new URL(r.url.replace(/[?#].*$/, "")));
        return r;
      },
    });
  }
  // the entry point of a child `node script.mjs`
  if (process.argv[1]) emit("entry", process.argv[1]);
}
