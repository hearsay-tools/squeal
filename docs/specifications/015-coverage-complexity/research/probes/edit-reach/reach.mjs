// Throwaway probe for research/edit-reach.md (2026-11-07). Read only.
//
// Per source file of a checkout: the test files an edit of it re-keys and their recorded seconds,
// and the path each re-key takes. A re-key comes from the store's stored closure of a test file
// (`test_files.closure_paths`: the runner's import graph, declared inputs, observed reads) or from
// a project's setup and config closure, which Squeal hashes into the environment of every test file
// of that project (src/runners/vitest/environment.ts) and which no stored closure holds.
//
// The path kind of each (source, test file) pair is the strongest reason, in this order:
//   direct      the test file imports the source with a value import (one hop)
//   transitive  value imports, through a path with no barrel and no test helper
//   barrel      value imports, but only through a re-export file
//   helper      value imports, but only through a test helper (testkit, test/ util, fixture)
//   typesModule value imports of a module that holds types only (reached through `export *`
//               or an `export { X } from` the transform cannot drop)
//   setup       the source is in the project's setupFiles / globalSetup / config closure
//   declared    squeal.config.json `inputs` names it for the test file
//   typeImport  only `import type` (or imports used for types) reach it: the run read it anyway
//   childProcess none of the above, and a process the test file started imported it (meta observedModules)
//   observed    none of the above: a path the run read (a file read, a bundle, a hash)
//
// The value graph is emulated: each file is transformed with esbuild (TS imports used only as types
// are dropped, as Vite's transform does; `verbatimModuleSyntax` where the package's tsconfig sets it)
// and its imports are read with es-module-lexer. Relative, `@/`, and workspace package specifiers
// are resolved; anything else is a package and leaves the graph.
//
// Usage: node reach.mjs <spec.json> <out.json>
//   spec: { repo, store, runs, config, modules (a node_modules root with esbuild, es-module-lexer),
//           aliases: {"@/": "packages/web/src/"}, verbatim: ["packages/web/"],
//           setup: {project: [files...]}, manual: "<regex of test paths not run on edit>",
//           helper: "<regex of test helper paths>", since: <epoch ms for real edits> }
import { DatabaseSync } from "node:sqlite";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, normalize, posix } from "node:path";

const spec = JSON.parse(readFileSync(process.argv[2], "utf8"));
const out = process.argv[3];
const req = createRequire(join(spec.modules, "x.js"));
const esbuild = req("esbuild");
const lexer = req("es-module-lexer");
await lexer.init;

const repo = spec.repo;
const tracked = execFileSync("git", ["-C", repo, "ls-files"], { encoding: "utf8", maxBuffer: 1 << 28 })
  .split("\n").filter(Boolean);
const trackedSet = new Set(tracked);
const CODE = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
const manual = spec.manual ? new RegExp(spec.manual) : null;
const helperRe = new RegExp(spec.helper);

// ---- store: closures and test files
const db = new DatabaseSync(spec.store, { readOnly: true });
const tests = [];
for (const r of db.prepare("select project, path, closure_paths from test_files").all()) {
  if (!trackedSet.has(r.path)) continue;
  tests.push({ project: r.project, path: r.path, closure: JSON.parse(r.closure_paths), manual: !!manual?.test(r.path) });
}
const testPaths = new Set(tests.map((t) => t.path));
// modules a test file's child processes imported (meta observedModules.<project>): code it ran out of process
const childModules = new Map();
for (const r of db.prepare("select key, value from meta where key like 'observedModules.%'").all()) {
  const project = r.key.slice("observedModules.".length);
  for (const [t, ps] of Object.entries(JSON.parse(r.value))) childModules.set(project + "\0" + t, new Set(ps));
}

// ---- recorded seconds: median of fileDurations over completed runs' report.json
const durs = new Map();
for (const d of readdirSync(spec.runs)) {
  const f = join(spec.runs, d, "report.json");
  if (!existsSync(f)) continue;
  let r;
  try { r = JSON.parse(readFileSync(f, "utf8")).report; } catch { continue; }
  for (const fd of r?.fileDurations ?? []) {
    if (!(fd.durationMs > 0)) continue;
    const k = fd.testFile.project + "\0" + fd.testFile.path;
    (durs.get(k) ?? durs.set(k, []).get(k)).push(fd.durationMs / 1000);
  }
}
const median = (a) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const fallback = new Map();
for (const r of db.prepare(`select c.project p, c.test_path t, sum(r.duration_ms) d from checks c
    join results r on r.check_id = c.id
    where r.recorded_at = (select max(recorded_at) from results r2 where r2.check_id = c.id) group by 1, 2`).all())
  fallback.set(r.p + "\0" + r.t, (r.d ?? 0) / 1000);
let fromReports = 0, fromResults = 0, none = 0;
for (const t of tests) {
  const k = t.project + "\0" + t.path;
  if (durs.has(k)) { t.sec = median(durs.get(k)); t.n = durs.get(k).length; fromReports++; }
  else if (fallback.has(k)) { t.sec = fallback.get(k); t.n = 0; fromResults++; }
  else { t.sec = 0; t.n = 0; none++; }
}

// ---- coverage (optional): the source paths each test file's newest coverage record holds (loaded by its run)
const loaded = new Map();
if (spec.code) {
  const { inflateRawSync } = await import("node:zlib");
  const code = new DatabaseSync(spec.code, { readOnly: true });
  const keyTest = new Map();
  for (const r of db.prepare("select distinct r.key k, c.test_path t from results r join checks c on c.id = r.check_id where c.kind = 'file'").all()) keyTest.set(r.k, r.t);
  const newest = new Map();
  for (const r of code.prepare("select result_key k, recorded_at a from coverage where provider_version = 3").all()) {
    const t = keyTest.get(r.k); if (!t) continue;
    const n = newest.get(t); if (!n || n.a < r.a) newest.set(t, r);
  }
  const get = code.prepare("select record from coverage where result_key = ? and provider_version = 3");
  const getPart = code.prepare("select part from coverage_parts where id = ?");
  const { constants } = await import("node:zlib");
  // a function other than the module's own top level ran (start at line 1, column 0 is the module)
  const ran = (src) => (src.functions ?? []).some((f) => f[4] === 1 && !(f[0] === 1 && f[1] === 0));
  const partCache = new Map();
  const part = (id) => { if (partCache.has(id)) return partCache.get(id);
    let v = null; try { const b = getPart.get(id)?.part; if (b) { const src = JSON.parse(inflateRawSync(b, { finishFlush: constants.Z_SYNC_FLUSH }).toString("utf8")); v = { path: src.path, called: ran(src) }; } } catch {}
    partCache.set(id, v); return v; };
  for (const [t, r] of newest) {
    try {
      const rec = JSON.parse(inflateRawSync(get.get(r.k).record).toString("utf8"));
      const m = new Map();
      for (const p of rec.unread ?? []) m.set(p, null); // loaded; called unknown
      for (const src of rec.sources ?? []) m.set(src.path, ran(src));
      if (Array.isArray(rec.parts)) { let at = 0, id = 0;
        for (let i = 0; i < rec.parts.length; i += 2) { at += rec.parts[i]; id += rec.parts[i + 1]; const pt = part(id); const path = rec.unread[at]; if (pt && pt.path === path) m.set(path, pt.called); } }
      loaded.set(t, m);
    } catch {}
  }
}

// ---- real edits: watch revisions of 1 to 3 paths since `since`
const edits = new Map();
let editRevisions = 0;
for (const r of db.prepare("select changes from revisions where trigger = 'watch' and created_at >= ?").all(spec.since ?? 0)) {
  const ch = JSON.parse(r.changes);
  if (ch.length < 1 || ch.length > 3) continue;
  editRevisions++;
  for (const c of ch) if (c.newHash) edits.set(c.path, (edits.get(c.path) ?? 0) + 1);
}

// ---- static graph
const pkgs = [];
for (const f of tracked) {
  if (!/(^|\/)package\.json$/.test(f) || f.includes("node_modules") || f.includes("fixtures")) continue;
  try { const p = JSON.parse(readFileSync(join(repo, f), "utf8")); if (p.name) pkgs.push({ name: p.name, dir: dirname(f) === "." ? "" : dirname(f), exports: p.exports }); } catch {}
}
const isFile = (p) => trackedSet.has(p) || (existsSync(join(repo, p)) && statSync(join(repo, p)).isFile());
function candidates(base) {
  const c = [base];
  if (/\.(js|jsx)$/.test(base)) c.push(base.replace(/\.js$/, ".ts"), base.replace(/\.js$/, ".tsx"), base.replace(/\.jsx$/, ".tsx"));
  if (/\.mjs$/.test(base)) c.push(base.replace(/\.mjs$/, ".mts"));
  if (/\.cjs$/.test(base)) c.push(base.replace(/\.cjs$/, ".cts"));
  for (const e of [".ts", ".tsx", ".js", ".mjs", ".cjs", ".jsx", ".json"]) c.push(base + e);
  for (const e of ["/index.ts", "/index.tsx", "/index.js", "/index.mjs"]) c.push(base + e);
  return c;
}
const firstFile = (base) => candidates(base).find(isFile) ?? null;
function resolveSpec(from, s) {
  s = s.split("?")[0];
  if (s.startsWith(".")) return firstFile(posix.normalize(posix.join(posix.dirname(from), s)));
  for (const [a, rep] of Object.entries(spec.aliases ?? {})) if (s.startsWith(a)) return firstFile(rep + s.slice(a.length));
  for (const p of pkgs) {
    if (s !== p.name && !s.startsWith(p.name + "/")) continue;
    const sub = s === p.name ? "." : "./" + s.slice(p.name.length + 1);
    let target = null;
    const ex = p.exports;
    if (typeof ex === "string" && sub === ".") target = ex;
    else if (ex && typeof ex === "object") {
      if (sub in ex) target = ex[sub];
      else for (const [k, v] of Object.entries(ex)) if (k.endsWith("/*") && sub.startsWith(k.slice(0, -1)) && typeof v === "string") { target = v.replace("*", sub.slice(k.length - 1)); break; }
      if (target && typeof target === "object") target = target.import ?? target.default ?? target.types ?? null;
    }
    if (!target && sub === ".") target = "./src/index.ts";
    if (!target) return null;
    const base = posix.normalize(posix.join(p.dir, target));
    // a workspace package that points at dist resolves to its source when dist is not tracked
    return firstFile(base) ?? firstFile(base.replace(/\/dist\//, "/src/").replace(/\.js$/, ".ts"));
  }
  return null;
}
const SRC_SPEC = /(?:^|[\s;}])(?:import|export)\s+(?:type\s+)?[^'"]*?from\s*['"]([^'"]+)['"]|(?:^|[\s;(])import\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|require\(\s*['"]([^'"]+)['"]\s*\)/gm;
const nodes = new Map(); // path -> {value:Set, all:Set, barrel, typesOnly}
function parse(path) {
  if (nodes.has(path)) return nodes.get(path);
  const n = { value: new Set(), all: new Set(), barrel: false, typesOnly: false };
  nodes.set(path, n);
  if (!CODE.test(path) || path.endsWith(".d.ts")) return n;
  let text;
  try { text = readFileSync(join(repo, path), "utf8"); } catch { return n; }
  for (const m of text.matchAll(SRC_SPEC)) { const s = m[1] ?? m[2] ?? m[3] ?? m[4]; const r = resolveSpec(path, s); if (r) n.all.add(r); }
  let code = text;
  if (/\.(ts|tsx|mts|cts|jsx)$/.test(path)) {
    const verbatim = (spec.verbatim ?? []).some((d) => path.startsWith(d));
    try {
      code = esbuild.transformSync(text, { loader: path.endsWith("x") ? "tsx" : "ts", format: "esm", jsx: "automatic",
        tsconfigRaw: { compilerOptions: { verbatimModuleSyntax: verbatim } } }).code;
    } catch { return n; }
  }
  let imports = [];
  try { [imports] = lexer.parse(code); imports = imports.map((im) => ({ n: im.n ?? im.specifier, ss: im.ss ?? im.importStart ?? -1, se: im.se ?? im.importEnd,
    d: im.d ?? (im.type === "dynamic" || im.type === "import.meta" ? 0 : -1) })); } catch { imports = []; for (const m of code.matchAll(SRC_SPEC)) imports.push({ n: m[1] ?? m[2] ?? m[3] ?? m[4], ss: -1 }); }
  let rest = code;
  for (const im of [...imports].sort((a, b) => b.ss - a.ss)) {
    if (im.n) { const r = resolveSpec(path, im.n); if (r) n.value.add(r); }
    if (im.ss >= 0 && im.d === -1) rest = rest.slice(0, im.ss) + rest.slice(im.se);
  }
  for (const m of code.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)) { const r = resolveSpec(path, m[1]); if (r) n.value.add(r); }
  rest = rest.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "").replace(/export\s*\{[^}]*\}\s*;?/g, "").replace(/[\s;]/g, "");
  // esbuild turns `export { a } from "./x"` into an import and an export list; a barrel is a module
  // whose transformed body holds only imports and export lists, with at least one export
  const reexports = /export\s*(\*|\{)/.test(code) && n.value.size > 0 ? 1 : 0;
  n.typesOnly = /\.(ts|tsx|mts|cts)$/.test(path) && code.replace(/export\s*\{\s*\}\s*;?/g, "").trim() === "";
  n.barrel = rest === "" && reexports >= 1;
  return n;
}
for (const f of tracked) if (CODE.test(f)) parse(f);
function bfs(start, edges, expand) {
  const seen = new Set([start]); const todo = [start];
  while (todo.length) { const m = todo.pop(); if (m !== start && !expand(m)) continue;
    for (const x of parse(m)[edges]) if (!seen.has(x)) { seen.add(x); todo.push(x); } }
  return seen;
}
const isHelper = (p) => helperRe.test(p) && !testPaths.has(p);

// ---- setup and config closures per project
const setup = new Map();
for (const [project, files] of Object.entries(spec.setup ?? {})) {
  const s = new Set();
  for (const f of files) for (const x of bfs(f, "value", () => true)) s.add(x);
  setup.set(project, s);
}

// ---- declared inputs
const inputs = JSON.parse(readFileSync(spec.config, "utf8")).inputs ?? {};
const declaredRules = Array.isArray(inputs) ? [{ test: "**", globs: inputs }] : Object.entries(inputs).map(([test, globs]) => ({ test, globs }));
const declaredFor = (t) => { const g = []; for (const r of declaredRules) if (posix.matchesGlob(t, r.test)) g.push(...r.globs); return g; };
const declaredHit = new Map();
const isDeclared = (globs, p) => globs.some((g) => posix.matchesGlob(p, g));

// ---- pairs
const KINDS = ["direct", "transitive", "barrel", "helper", "typesModule", "setup", "declared", "typeImport", "childProcess", "observed"];
const per = new Map(); // source -> {files, sec, auto:{files,sec}, kinds:{k:sec}}
let suite = { files: 0, sec: 0, autoFiles: 0, autoSec: 0 };
const byRule = {}, bySetup = {};
const covByKind = {}, covByKindEdits = {}, covBySource = new Map();
const valuePairs = new Map(); // test -> Set of sources reached only by value imports (auto tests)
const VALUE = new Set(["direct", "transitive", "barrel", "helper", "typesModule"]);
for (const t of tests) {
  suite.files++; suite.sec += t.sec; if (!t.manual) { suite.autoFiles++; suite.autoSec += t.sec; }
  const value = bfs(t.path, "value", () => true);
  const noBarrel = bfs(t.path, "value", (m) => !parse(m).barrel);
  const noHelper = bfs(t.path, "value", (m) => !isHelper(m));
  const plain = bfs(t.path, "value", (m) => !parse(m).barrel && !isHelper(m));
  const all = bfs(t.path, "all", () => true);
  const direct = parse(t.path).value;
  const globs = declaredFor(t.path);
  const reach = new Set(t.closure.filter((p) => p !== t.path && !p.endsWith("/")));
  for (const p of setup.get(t.project) ?? []) if (p !== t.path) reach.add(p);
  for (const p of reach) {
    if (testPaths.has(p) || !trackedSet.has(p)) continue;
    let kind;
    const nd = parse(p);
    if (direct.has(p) && !nd.typesOnly) kind = "direct";
    else if (plain.has(p) && !nd.typesOnly) kind = "transitive";
    else if (value.has(p) && !nd.typesOnly && !noBarrel.has(p)) kind = "barrel";
    else if (value.has(p) && !nd.typesOnly) kind = "helper";
    else if (value.has(p)) kind = "typesModule";
    else if (setup.get(t.project)?.has(p)) { kind = "setup"; if (!t.manual) { const e = (bySetup[t.project] ??= { sec: 0, editSec: 0 }); e.sec += t.sec; e.editSec += t.sec * (edits.get(p) ?? 0); } }
    else if (isDeclared(globs, p)) { kind = "declared";
      if (!t.manual) for (const r of declaredRules) if (posix.matchesGlob(t.path, r.test) && isDeclared(r.globs, p)) { const k = r.test; const e = (byRule[k] ??= { sec: 0, editSec: 0 }); e.sec += t.sec; e.editSec += t.sec * (edits.get(p) ?? 0); } }
    else if (all.has(p)) kind = "typeImport";
    else kind = childModules.get(t.project + "\0" + t.path)?.has(p) ? "childProcess" : "observed";
    if (spec.code && !t.manual && CODE.test(p) && !testPaths.has(p)) {
      const lm = loaded.get(t.path);
      const st = !lm ? "noRecord" : !lm.has(p) ? "notLoaded" : lm.get(p) === true ? "called" : lm.get(p) === false ? "loadedOnly" : "loadedUnknown";
      const z = () => ({ called: 0, loadedOnly: 0, loadedUnknown: 0, notLoaded: 0, noRecord: 0 });
      const k = (covByKind[kind] ??= z()); k[st] += t.sec;
      const ke = (covByKindEdits[kind] ??= z()); ke[st] += t.sec * (edits.get(p) ?? 0);
      const c = (covBySource.get(p) ?? covBySource.set(p, z()).get(p)); c[st] += t.sec;
    }
    if (!t.manual && VALUE.has(kind) && CODE.test(p)) (valuePairs.get(t) ?? valuePairs.set(t, new Set()).get(t)).add(p);
    let e = per.get(p);
    if (!e) per.set(p, (e = { files: 0, sec: 0, autoFiles: 0, autoSec: 0, kinds: {}, autoKinds: {}, projects: {} }));
    e.files++; e.sec += t.sec; e.kinds[kind] = (e.kinds[kind] ?? 0) + t.sec;
    if (!t.manual) { e.autoFiles++; e.autoSec += t.sec; e.autoKinds[kind] = (e.autoKinds[kind] ?? 0) + t.sec; e.projects[t.project] = (e.projects[t.project] ?? 0) + 1; }
  }
}
const sources = [...per].filter(([p]) => CODE.test(p) && !testPaths.has(p)).map(([p, e]) => ({ path: p, ...e,
  edits: edits.get(p) ?? 0, barrel: parse(p).barrel, typesOnly: parse(p).typesOnly, helper: isHelper(p),
  inSetup: [...setup].filter(([, s]) => s.has(p)).map(([k]) => k) }));
const sum = (rows, f) => rows.reduce((a, r) => a + f(r), 0);
const kindShares = (rows, key, weight) => { const o = {}; let tot = 0;
  for (const r of rows) for (const [k, v] of Object.entries(r[key])) { o[k] = (o[k] ?? 0) + v * weight(r); tot += v * weight(r); }
  return Object.fromEntries(KINDS.map((k) => [k, tot ? +(100 * (o[k] ?? 0) / tot).toFixed(1) : 0])); };
// ---- cut: for a gateway file N, the value pairs that no longer hold if N passed no import on
const totalPairSec = sum(sources, (r) => r.autoSec), totalPairEditSec = sum(sources, (r) => r.autoSec * r.edits);
const through = new Map();
const closureOf = new Map();
const cl = (n) => closureOf.get(n) ?? closureOf.set(n, bfs(n, "value", () => true)).get(n);
for (const [t, ps] of valuePairs) for (const n of bfs(t.path, "value", () => true)) {
  if (n === t.path || testPaths.has(n) || parse(n).value.size === 0) continue;
  let w = 0; for (const p of cl(n)) if (p !== n && ps.has(p)) w++;
  through.set(n, (through.get(n) ?? 0) + w * t.sec);
}
const cuts = [];
for (const [n] of [...through].sort((a, b) => b[1] - a[1]).slice(0, spec.cuts ?? 40)) {
  let sec = 0, editSec = 0, testsHit = 0;
  for (const [t, ps] of valuePairs) {
    const v = bfs(t.path, "value", () => true);
    if (!v.has(n)) continue;
    const without = bfs(t.path, "value", (m) => m !== n);
    let lost = 0;
    for (const p of ps) if (p !== n && !without.has(p)) { lost++; sec += t.sec; editSec += t.sec * (edits.get(p) ?? 0); }
    if (lost) testsHit++;
  }
  cuts.push({ path: n, barrel: parse(n).barrel, helper: isHelper(n), testsHit, pctOfPairSec: +(100 * sec / totalPairSec).toFixed(1),
    pctOfRealEditSec: totalPairEditSec ? +(100 * editSec / totalPairEditSec).toFixed(1) : null, imports: parse(n).value.size });
}
cuts.sort((a, b) => b.pctOfPairSec - a.pctOfPairSec);
const pct = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { pctOfPairSec: +(100 * v.sec / totalPairSec).toFixed(1),
  pctOfRealEditSec: totalPairEditSec ? +(100 * v.editSec / totalPairEditSec).toFixed(1) : null }]).sort((a, b) => b[1].pctOfPairSec - a[1].pctOfPairSec));
const allCode = tracked.filter((p) => CODE.test(p) && !testPaths.has(p) && !p.includes("node_modules"));
const result = {
  repo, head: execFileSync("git", ["-C", repo, "rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim(),
  tests: tests.length, durations: { fromReports, fromResults, none }, suite,
  editRevisions, editedSources: sources.filter((s) => s.edits > 0).length,
  sourceFiles: { tracked: allCode.length, reached: sources.length },
  setup: Object.fromEntries([...setup].map(([k, s]) => [k, [...s].filter((p) => !p.includes("node_modules")).sort()])),
  sharesEverySourceOnce: kindShares(sources, "autoKinds", () => 1),
  sharesByRealEdits: kindShares(sources, "autoKinds", (r) => r.edits),
  meanAutoSharePerSource: +(100 * sum(sources, (r) => r.autoSec) / allCode.length / suite.autoSec).toFixed(1),
  meanAutoSharePerRealEdit: +(100 * sum(sources, (r) => r.autoSec * r.edits) / Math.max(1, sum(sources, (r) => r.edits)) / suite.autoSec).toFixed(1),
  top: sources.sort((a, b) => b.autoSec - a.autoSec).slice(0, spec.top ?? 40).map((s) => ({
    path: s.path, files: s.autoFiles, sec: Math.round(s.autoSec), share: +(100 * s.autoSec / suite.autoSec).toFixed(1),
    allFiles: s.files, allSec: Math.round(s.sec), edits: s.edits, barrel: s.barrel, typesOnly: s.typesOnly, helper: s.helper, inSetup: s.inSetup,
    coverage: covBySource.has(s.path) ? Object.fromEntries(Object.entries(covBySource.get(s.path)).map(([k, v]) => [k, +(100 * v / s.autoSec).toFixed(0)])) : undefined,
    kinds: Object.fromEntries(Object.entries(s.autoKinds).map(([k, v]) => [k, +(100 * v / s.autoSec).toFixed(0)]).sort((a, b) => b[1] - a[1])),
    projects: s.projects })),
  graph: Object.fromEntries([...nodes].filter(([k]) => trackedSet.has(k)).map(([k, n]) => [k, { v: [...n.value], a: [...n.all].filter((x) => !n.value.has(x)), b: n.barrel || undefined, t: n.typesOnly || undefined }])),
  testSec: Object.fromEntries(tests.map((t) => [t.path, { s: +t.sec.toFixed(2), p: t.project, m: t.manual || undefined }])),
  edits: Object.fromEntries(edits),
  coverage: spec.code ? { testFilesWithRecord: loaded.size, byKind: covByKind, byKindRealEdits: covByKindEdits } : undefined,
  cuts, setupKinds: pct(bySetup), declaredKinds: pct(byRule),
  all: sources.map((s) => ({ path: s.path, files: s.autoFiles, sec: Math.round(s.autoSec), edits: s.edits, kinds: s.autoKinds, coverage: covBySource.get(s.path) })),
};
const { writeFileSync } = await import("node:fs");
writeFileSync(out, JSON.stringify(result, null, 1));
const { all, top, setup: st, cuts: cu, graph: _g, testSec: _t, edits: _e, ...head } = result;
for (const c of cu.slice(0, 20)) console.log("cut", JSON.stringify(c));
console.log(JSON.stringify(head, null, 1));
for (const r of top.slice(0, 30)) console.log(r.share.toString().padStart(5), String(r.files).padStart(5), String(r.sec).padStart(7), r.edits, r.path, JSON.stringify(r.kinds), r.barrel ? "BARREL" : "", r.typesOnly ? "TYPES" : "", r.inSetup.join(","));
