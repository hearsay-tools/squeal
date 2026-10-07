// THROWAWAY probe. Static import graph of node:test files: parse + resolve, BFS from test files.
// Parsers: es-module-lexer on the raw source (default), or on module.stripTypeScriptTypes output.
// Resolvers: oxc | enhanced | ts | ts-bundler | hand.
import { init, parse } from "es-module-lexer";
import { readFileSync, existsSync, statSync, realpathSync, readdirSync } from "node:fs";
import { dirname, join, resolve as presolve, extname, relative } from "node:path";
import { isBuiltin, stripTypeScriptTypes, createRequire } from "node:module";
import { ResolverFactory } from "oxc-resolver";
import erPkg from "enhanced-resolve";
const require = createRequire(import.meta.url);
const ts = require("ts6");
await init;

const EXTS = [".ts", ".tsx", ".mts", ".cts", ".js", ".mjs", ".cjs", ".json"];
const ALIAS = { ".js": [".ts", ".tsx", ".js"], ".mjs": [".mts", ".mjs"], ".cjs": [".cts", ".cjs"] };
const REQUIRE_RE = /\brequire\s*\(\s*(["'])([^"'\n]+)\1\s*\)/g;
const isFile = (p) => { try { return statSync(p).isFile(); } catch { return false; } };
const isDir = (p) => { try { return statSync(p).isDirectory(); } catch { return false; } };
const real = (p) => { try { return realpathSync(p); } catch { return p; } };

/**
 * Specifiers of one file: [{ spec, kind: 'import'|'dynamic'|'require'|'glob'|'type' }], plus
 * dynamic imports with no static specifier at all. es-module-lexer 3 reports TypeScript
 * type-only imports with `typeOnly` and a template-literal import() as a glob (`./p/*.ts`).
 */
export function parseFile(file, src, { strip = false } = {}) {
  const out = [], computed = [];
  const code = strip && /\.[mc]?tsx?$/.test(file) ? stripTypeScriptTypes(src) : src;
  const [imports] = parse(code);
  for (const i of imports) {
    if (i.type === "import-meta") continue;
    if (i.specifier == null) { computed.push(code.slice(i.importStart, i.importEnd)); continue; }
    const kind = i.typeOnly || i.probablyTypeOnly ? "type" : i.glob ? "glob" : i.type === "dynamic" ? "dynamic" : "import";
    out.push({ spec: i.specifier, kind });
  }
  for (const m of code.matchAll(REQUIRE_RE)) out.push({ spec: m[2], kind: "require" });
  return { specs: out, computed };
}

/** Expand a relative glob specifier (`./plugins/*.ts`) against the directory on disk, one segment deep. */
export function expandGlob(spec, from) {
  if (!spec.startsWith(".")) return [];
  const abs = presolve(dirname(from), spec); const dir = dirname(abs);
  if (dir.includes("*")) return [];
  const re = new RegExp("^" + abs.slice(dir.length + 1).split("*").map((x) => x.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join("[^/]*") + "$");
  try { return readdirSync(dir).filter((f) => re.test(f)).map((f) => join(dir, f)); } catch { return []; }
}

// ---- resolvers: (spec, fromFile, kind) -> { path } | { builtin } | { error, candidates? }
function nearest(dir, name) {
  for (let d = dir; ; d = dirname(d)) { if (existsSync(join(d, name))) return join(d, name); if (dirname(d) === d) return null; }
}

export function makeResolver(name) {
  if (name === "oxc") {
    const common = { tsconfig: "auto", extensions: EXTS, extensionAlias: ALIAS, symlinks: true };
    const esm = new ResolverFactory({ ...common, conditionNames: ["node", "import"] });
    const cjs = new ResolverFactory({ ...common, conditionNames: ["node", "require"] });
    const r = (spec, from, kind) => {
      if (isBuiltin(spec)) return { builtin: true };
      const res = (kind === "require" ? cjs : esm).resolveFileSync(from, spec);
      return res.path ? { path: res.path } : { error: res.error };
    };
    r.clear = () => { esm.clearCache(); cjs.clearCache(); };
    return r;
  }
  if (name === "enhanced") {
    const { CachedInputFileSystem, ResolverFactory: ERF } = erPkg;
    let fsys = new CachedInputFileSystem(require("node:fs"), 4000);
    let cache = new Map();
    const get = (tsconfig, kind) => {
      const key = `${tsconfig}|${kind}`;
      if (!cache.has(key)) cache.set(key, ERF.createResolver({
        fileSystem: fsys, useSyncFileSystemCalls: true, extensions: EXTS, extensionAlias: ALIAS,
        conditionNames: ["node", kind === "require" ? "require" : "import"], symlinks: true,
        ...(tsconfig ? { tsconfig: { configFile: tsconfig } } : {}),
      }));
      return cache.get(key);
    };
    const r = (spec, from, kind) => {
      if (isBuiltin(spec)) return { builtin: true };
      try { const p = get(nearest(dirname(from), "tsconfig.json"), kind).resolveSync({}, dirname(from), spec); return p ? { path: p } : { error: "false" }; }
      catch (e) { return { error: e.message.split("\n")[0] }; }
    };
    r.clear = () => { fsys = new CachedInputFileSystem(require("node:fs"), 4000); cache = new Map(); };
    return r;
  }
  if (name === "ts" || name === "ts-bundler") {
    let opts = new Map(), caches = new Map();
    const optionsFor = (tsconfig) => {
      if (!opts.has(tsconfig)) {
        let o = { allowJs: true, resolveJsonModule: true, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext };
        if (tsconfig) {
          const cfg = ts.readConfigFile(tsconfig, ts.sys.readFile);
          o = { ...ts.parseJsonConfigFileContent(cfg.config, ts.sys, dirname(tsconfig)).options, allowJs: true, resolveJsonModule: true };
        }
        if (name === "ts-bundler") o = { ...o, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler };
        opts.set(tsconfig, o);
        caches.set(tsconfig, ts.createModuleResolutionCache(dirname(tsconfig ?? "/"), (x) => x, o));
      }
      return [opts.get(tsconfig), caches.get(tsconfig)];
    };
    const r = (spec, from, kind) => {
      if (isBuiltin(spec)) return { builtin: true };
      const tsconfig = nearest(dirname(from), "tsconfig.json");
      const [o, c] = optionsFor(tsconfig);
      const mode = kind === "require" ? ts.ModuleKind.CommonJS : ts.ModuleKind.ESNext;
      const res = ts.resolveModuleName(spec, from, o, ts.sys, c, undefined, mode);
      const p = res.resolvedModule?.resolvedFileName;
      if (!p) return { error: "unresolved", candidates: res.failedLookupLocations };
      return { path: p.endsWith(".d.ts") ? p.replace(/\.d\.ts$/, ".ts") : p };
    };
    r.clear = () => { opts = new Map(); caches = new Map(); };
    return r;
  }
  if (name === "hand") return handResolver();
  throw new Error(`unknown resolver ${name}`);
}

/** Hand-rolled: what tsx in Node's loader chain accepts, nothing more. */
function handResolver() {
  let json = new Map(), near = new Map();
  const readJson = (p) => { if (!json.has(p)) { try { json.set(p, JSON.parse(readFileSync(p, "utf8"))); } catch { json.set(p, null); } } return json.get(p); };
  const nearestCached = (dir, n) => { const k = `${dir}|${n}`; if (!near.has(k)) near.set(k, nearest(dir, n)); return near.get(k); };
  const pick = (t, kind) => {
    if (typeof t === "string" || t === null) return t;
    if (Array.isArray(t)) return pick(t[0], kind);
    for (const c of ["node", kind === "require" ? "require" : "import", "default"]) if (c in t) { const v = pick(t[c], kind); if (v) return v; }
    return null;
  };
  const matchMap = (map, key, kind) => {
    if (typeof map === "string" || Array.isArray(map) || (map && !Object.keys(map).some((k) => k.startsWith(".") || k.startsWith("#")))) map = { ".": map };
    if (key in map) return pick(map[key], kind);
    for (const [k, v] of Object.entries(map)) {
      const star = k.indexOf("*"); if (star < 0) continue;
      const pre = k.slice(0, star), post = k.slice(star + 1);
      if (key.startsWith(pre) && key.endsWith(post) && key.length >= k.length - 1) { const t = pick(v, kind); return t && t.replaceAll("*", key.slice(pre.length, key.length - post.length)); }
    }
    return null;
  };
  const file = (base, tried) => {
    const ext = extname(base);
    if (ALIAS[ext]) for (const e of ALIAS[ext]) { const p = base.slice(0, -ext.length) + e; tried.push(p); if (isFile(p)) return p; }
    tried.push(base); if (isFile(base)) return base;
    for (const e of EXTS) { tried.push(base + e); if (isFile(base + e)) return base + e; }
    if (isDir(base)) for (const e of EXTS) { const p = join(base, "index" + e); tried.push(p); if (isFile(p)) return p; }
    return null;
  };
  const done = (p, tried) => (p ? { path: real(p) } : { error: "unresolved", candidates: tried });
  const r = (spec, from, kind) => {
    if (isBuiltin(spec)) return { builtin: true };
    const tried = [];
    if (spec.startsWith("file:")) return done(file(new URL(spec).pathname, tried), tried);
    if (spec.startsWith(".") || spec.startsWith("/")) return done(file(presolve(dirname(from), spec), tried), tried);
    if (spec.startsWith("#")) {
      const pj = nearestCached(dirname(from), "package.json"); const t = pj && readJson(pj)?.imports && matchMap(readJson(pj).imports, spec, kind);
      return t ? done(file(presolve(dirname(pj), t), tried), tried) : { error: "no imports match", candidates: tried };
    }
    const tc = nearestCached(dirname(from), "tsconfig.json"); const paths = tc && readJson(tc)?.compilerOptions?.paths;
    if (paths) for (const [k, targets] of Object.entries(paths)) {
      const star = k.indexOf("*"); const pre = star < 0 ? k : k.slice(0, star), post = star < 0 ? "" : k.slice(star + 1);
      if (star < 0 ? spec === k : spec.startsWith(pre) && spec.endsWith(post)) {
        const mid = star < 0 ? "" : spec.slice(pre.length, spec.length - post.length);
        for (const t of targets) { const p = file(presolve(dirname(tc), t.replace("*", mid)), tried); if (p) return done(p, tried); }
      }
    }
    const parts = spec.split("/"); const n = spec.startsWith("@") ? 2 : 1;
    const pkgName = parts.slice(0, n).join("/"), sub = parts.length > n ? "./" + parts.slice(n).join("/") : ".";
    for (let d = dirname(from); ; d = dirname(d)) {
      const dir = join(d, "node_modules", pkgName); tried.push(dir);
      if (isDir(dir)) {
        const pj = readJson(join(dir, "package.json"));
        if (pj?.exports) { const t = matchMap(pj.exports, sub, kind); return t ? done(file(presolve(dir, t), tried), tried) : { error: "not exported", candidates: tried }; }
        return done(file(sub === "." ? presolve(dir, pj?.main ?? "index") : presolve(dir, sub), tried), tried);
      }
      if (dirname(d) === d) return { error: "package not found", candidates: tried };
    }
  };
  r.clear = () => { json = new Map(); near = new Map(); };
  return r;
}

/** BFS from test files. Returns { deps: Map<file, Set<file>>, unresolved, computed, timing }. */
export function buildGraph(testFiles, resolve, { strip = false, parsed = null, types = false } = {}) {
  const deps = new Map(), unresolved = [], computed = [], globs = [];
  let parseMs = 0, resolveMs = 0;
  const queue = testFiles.map((f) => real(f));
  while (queue.length) {
    const f = queue.pop();
    if (deps.has(f)) continue;
    const set = new Set(); deps.set(f, set);
    if (!/\.([mc]?[jt]sx?)$/.test(f)) continue;
    let t = performance.now();
    const p = parsed?.get(f) ?? parseFile(f, readFileSync(f, "utf8"), { strip });
    parsed?.set(f, p);
    parseMs += performance.now() - t;
    computed.push(...p.computed.map((c) => [f, c]));
    t = performance.now();
    for (const { spec, kind } of p.specs) {
      if (kind === "type" && !types) continue;
      if (kind === "glob") {
        globs.push([f, spec]);
        for (const g of expandGlob(spec, f)) { set.add(real(g)); if (!deps.has(real(g))) queue.push(real(g)); }
        continue;
      }
      const r = resolve(spec, f, kind === "type" ? "import" : kind);
      if (r.builtin) continue;
      if (!r.path) { unresolved.push({ from: f, spec, kind, error: r.error, candidates: r.candidates?.length ?? null }); continue; }
      if (r.path.includes("/node_modules/")) continue;
      set.add(r.path);
      if (!deps.has(r.path)) queue.push(r.path);
    }
    resolveMs += performance.now() - t;
  }
  return { deps, unresolved, computed, globs, timing: { parseMs, resolveMs } };
}

export function closureOf(deps, root) {
  const seen = new Set([root]), stack = [root];
  while (stack.length) for (const d of deps.get(stack.pop()) ?? []) if (!seen.has(d)) { seen.add(d); stack.push(d); }
  return seen;
}

export const rel = (root, p) => relative(root, p);
