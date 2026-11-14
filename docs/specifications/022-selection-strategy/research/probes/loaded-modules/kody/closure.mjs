// Throwaway probe (022 research, 2026-11-14). Read only: reads a Kody checkout and Kody's CI
// test-module-map shards; writes one JSON result file. Runs no Kody code.
//
// Compares, per test file, the repo modules it evaluated in a CI run (Kody's map) with an
// emulated Vite import closure: esbuild transform (type-only imports dropped) + es-module-lexer,
// relative / alias / `#` subpath / workspace-package resolution, static and dynamic edges kept apart.
//
// Usage: node closure.mjs <repo-at-map-commit> <maps-dir> <node_modules-root> <out.json> [commits=50]
//   env VERBATIM=0 transforms TS without verbatimModuleSyntax (default 1, as Kody's tsconfigs set it).
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, posix } from "node:path";

const [repo, mapsDir, modulesRoot, out, nCommitsArg] = process.argv.slice(2);
const nCommits = Number(nCommitsArg ?? 50);
const verbatim = process.env.VERBATIM !== "0";
const req = createRequire(join(modulesRoot, "x.js"));
const esbuild = req("esbuild");
const lexer = req("es-module-lexer");
await lexer.init;
const git = (...a) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8", maxBuffer: 1 << 28 });

// ---- map: merge shards as mergeTestModuleMapShards does
const shards = [];
for (const d of readdirSync(mapsDir, { recursive: true })) if (String(d).endsWith(".json")) shards.push(JSON.parse(readFileSync(join(mapsDir, String(d)), "utf8")));
const commit = shards[0].commit;
if (shards.some((s) => s.commit !== commit)) throw new Error("mixed commits");
const seen = new Map(), observed = new Map();
for (const s of shards) for (const [p, tests] of Object.entries(s.projects)) {
  const e = seen.get(p) ?? { count: s.shard?.count ?? 1, idx: new Set() }; e.idx.add(s.shard?.index ?? 1); seen.set(p, e);
  const m = observed.get(p) ?? new Map();
  for (const [t, ix] of Object.entries(tests)) m.set(t, new Set(ix.map((i) => s.modules[i])));
  observed.set(p, m);
}
for (const [p, e] of seen) if (e.idx.size !== e.count) observed.delete(p);
const head = git("rev-parse", "HEAD").trim();

// ---- repo files
const tracked = git("ls-files").split("\n").filter(Boolean);
const trackedSet = new Set(tracked);
const CODE = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
const isFile = (p) => trackedSet.has(p);
const pkgs = [];
for (const f of tracked) {
  if (!/(^|\/)package\.json$/.test(f) || f.includes("fixtures") || f.includes("node_modules")) continue;
  try { const p = JSON.parse(readFileSync(join(repo, f), "utf8")); pkgs.push({ name: p.name, dir: dirname(f) === "." ? "" : dirname(f), exports: p.exports, main: p.main, imports: p.imports }); } catch {}
}
function candidates(base) {
  const c = [base];
  if (/\.js$/.test(base)) c.push(base.replace(/\.js$/, ".ts"), base.replace(/\.js$/, ".tsx"));
  if (/\.jsx$/.test(base)) c.push(base.replace(/\.jsx$/, ".tsx"));
  if (/\.mjs$/.test(base)) c.push(base.replace(/\.mjs$/, ".mts"));
  if (/\.cjs$/.test(base)) c.push(base.replace(/\.cjs$/, ".cts"));
  for (const e of [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts", ".json"]) c.push(base + e);
  for (const e of [".ts", ".tsx", ".js", ".jsx", ".mjs"]) c.push(base + "/index" + e);
  return c;
}
const firstFile = (base) => candidates(posix.normalize(base)).find(isFile) ?? null;

// ---- per-project aliases (vitest-shared.ts, vitest.node.config.ts, vite-harfbuzz-worker.ts)
const W = "packages/worker/";
const shared = [[/^#app\//, W + "src/app/"], [/^#client\//, W + "client/"], [/^#universal\//, W + "universal/"], [/^#worker\//, W + "src/"], [/^#mcp\//, W + "src/mcp/"]];
const nodeAliases = [
  [/^#start\/server\/(.*)$/, W + "start/server/$1.ts"],
  ["#worker/og/og-image-assets.ts", W + "src/og/og-image-assets.node.ts"], [/\/og\/og-image-assets\.ts$/, W + "src/og/og-image-assets.node.ts"],
  ["#worker/og/og-resvg-wasm.ts", W + "src/og/og-resvg-wasm.node.ts"], [/\/og\/og-resvg-wasm\.ts$/, W + "src/og/og-resvg-wasm.node.ts"],
  ["#worker/og/og-binary-assets.ts", W + "src/og/og-binary-assets.node.ts"], [/\/og\/og-binary-assets\.ts$/, W + "src/og/og-binary-assets.node.ts"],
  ["@sentry/cloudflare", W + "src/test-support/sentry-cloudflare-stub.ts"],
  ["cloudflare:workers", W + "src/test-support/cloudflare-workers-stub.ts"],
  ["cloudflare:workflows", W + "src/test-support/cloudflare-workflows-stub.ts"],
  ["./node_modules/.kody-generated/oauth-provider.mjs", "@cloudflare/workers-oauth-provider"],
  ["./node_modules/.kody-generated/local-execute-runtime-support.mjs", W + "src/package-runtime/local-execute-runtime-support.ts"],
  ["./node_modules/.kody-generated/isomorphic-git.mjs", W + "src/repo/isomorphic-git-module.ts"],
  ["./node_modules/.kody-generated/postal-mime.mjs", W + "src/email/postal-mime-module.ts"],
  ["./node_modules/.kody-generated/disposable-email-domains.mjs", W + "src/identity/disposable-email-domains-module.ts"],
  ["./node_modules/.kody-generated/codemode-normalize.mjs", W + "src/mcp/codemode-normalize-module.ts"],
];
const workersAliases = [["harfbuzzjs", W + "src/og/harfbuzz-worker.ts"]];
const PROJECTS = { "node-unit": [...shared, ...nodeAliases], "workers-unit": [...shared, ...workersAliases] };
// project aliases come first in Vite's merged alias list? mergeConfig concatenates shared first; the
// shared ones only match `#app/` etc., which the node list does not overlap except the og strings,
// which are more specific: apply project aliases before shared ones.
for (const p of Object.keys(PROJECTS)) PROJECTS[p] = [...PROJECTS[p].slice(shared.length), ...shared];

function applyAlias(aliases, s) {
  for (const [find, rep] of aliases) {
    if (typeof find === "string") { if (s === find || s.startsWith(find + "/")) return { to: rep + s.slice(find.length), alias: true }; }
    // an unanchored regex alias with an absolute replacement (vitest.node.config.ts og aliases) means "this file"
    else if (find.test(s)) return { to: find.source.startsWith("^") ? s.replace(find, rep) : rep, alias: true };
  }
  return null;
}
const nearestPkg = (from) => { let d = posix.dirname(from); for (;;) { const p = pkgs.find((x) => x.dir === (d === "." ? "" : d)); if (p) return p; if (d === "." || d === "") return null; d = posix.dirname(d); } };
function subpath(map, sub) {
  if (!map || typeof map !== "object") return null;
  if (sub in map) { let t = map[sub]; if (t && typeof t === "object") t = t.import ?? t.default ?? t.types ?? null; return t; }
  for (const [k, v] of Object.entries(map)) if (k.includes("*")) { const [a, b] = k.split("*"); if (sub.startsWith(a) && sub.endsWith(b) && sub.length >= a.length + b.length) { let t = v; if (t && typeof t === "object") t = t.import ?? t.default ?? null; if (typeof t === "string") return t.replace("*", sub.slice(a.length, sub.length - b.length)); } }
  return null;
}
// returns {path} | {external:true} | {unresolved:true, why}
function resolveSpec(project, from, raw) {
  let s = raw.replace(/\?.*$/, "");
  const a = applyAlias(PROJECTS[project], s);
  if (a) s = a.to;
  if (s.startsWith("./") || s.startsWith("../") || (a && !s.startsWith("@") && s.includes("/") && !s.startsWith("."))) {
    const base = s.startsWith(".") ? posix.join(posix.dirname(from), s) : s;
    if (s.startsWith(".") && posix.normalize(base).includes("node_modules/")) return { external: true };
    const f = firstFile(base);
    return f ? { path: f } : { unresolved: true, why: "relative/alias" };
  }
  if (s.startsWith("/")) return { unresolved: true, why: "absolute" };
  if (s.startsWith("#")) {
    const pk = nearestPkg(from);
    let t = subpath(pk?.imports, s);
    let dir = pk?.dir ?? "";
    if (!t) { const root = pkgs.find((x) => x.dir === ""); t = subpath(root?.imports, s); dir = ""; }
    if (!t) return { unresolved: true, why: "#subpath" };
    const f = firstFile(posix.join(dir, t));
    return f ? { path: f } : { unresolved: true, why: "#subpath-target" };
  }
  for (const p of pkgs) {
    if (!p.name || (s !== p.name && !s.startsWith(p.name + "/"))) continue;
    const sub = s === p.name ? "." : "./" + s.slice(p.name.length + 1);
    let t = subpath(typeof p.exports === "string" ? { ".": p.exports } : p.exports, sub);
    if (!t && sub === ".") t = p.main ?? "./src/index.ts";
    if (!t && !p.exports) t = sub;
    if (!t) return { unresolved: true, why: "workspace-export" };
    const base = posix.join(p.dir, t);
    const f = firstFile(base) ?? firstFile(base.replace(/\/dist\//, "/src/").replace(/\.js$/, ".ts"));
    return f ? { path: f } : { unresolved: true, why: "workspace-target" };
  }
  return { external: true };
}

// ---- parse every tracked code file once
const parsed = new Map(); // path -> [{spec, kind: static|dynamic|glob|nonliteral|require}]
const parseErr = [];
for (const f of tracked) {
  if (!CODE.test(f) || f.endsWith(".d.ts")) continue;
  let code;
  try { code = readFileSync(join(repo, f), "utf8"); } catch { continue; }
  if (/\.(ts|tsx|mts|cts|jsx)$/.test(f)) {
    try {
      code = esbuild.transformSync(code, { loader: f.endsWith("x") ? "tsx" : "ts", format: "esm", jsx: "automatic", target: "es2023",
        tsconfigRaw: { compilerOptions: { verbatimModuleSyntax: verbatim } } }).code;
    } catch (e) { parseErr.push(f); parsed.set(f, []); continue; }
  }
  const list = [];
  try {
    const [imports] = lexer.parse(code);
    for (const im of imports) {
      if (im.type === "dynamic") list.push(im.specifier === undefined ? { kind: "nonliteral" } : { spec: im.specifier, kind: im.glob ? "glob" : "dynamic" });
      else if (im.type === "static" || im.type === "reexport-star") list.push({ spec: im.specifier ?? im.n, kind: "static" });
    }
  } catch { parseErr.push(f); }
  for (const m of code.matchAll(/\brequire\(\s*['"]([^'"]+)['"]\s*\)/g)) list.push({ spec: m[1], kind: "require" });
  parsed.set(f, list);
}
const globCache = new Map();
function expandGlob(project, from, spec) {
  // Vite's dynamic-import-vars: relative template globs; one `*` matches within a directory
  const a = applyAlias(PROJECTS[project], spec); const s = a ? a.to : spec;
  if (!s.startsWith(".") && !a) return [];
  const base = s.startsWith(".") ? posix.normalize(posix.join(posix.dirname(from), s)) : s;
  const re = new RegExp("^" + base.split("*").map((x) => x.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join("[^/]*") + "$");
  const k = re.source; if (!globCache.has(k)) globCache.set(k, tracked.filter((t) => re.test(t)));
  return globCache.get(k);
}

// ---- per-project graph
const stats = {};
function graph(project) {
  const st = { static: new Map(), dynamic: new Map() };
  const un = { total: 0, repoLike: 0, unresolved: 0, why: {}, examples: [], nonliteral: 0, globs: 0, globTargets: 0, requires: 0 };
  for (const [f, list] of parsed) {
    const s = new Set(), d = new Set();
    for (const im of list) {
      if (im.kind === "nonliteral") { un.nonliteral++; continue; }
      if (!im.spec) continue;
      un.total++;
      if (im.kind === "glob") { un.globs++; for (const t of expandGlob(project, f, im.spec)) { d.add(t); un.globTargets++; } continue; }
      const r = resolveSpec(project, f, im.spec);
      if (r.path) { (im.kind === "dynamic" ? d : s).add(r.path); un.repoLike++; if (im.kind === "require") un.requires++; }
      else if (r.unresolved) { (st.unresolvedIn ??= new Map()).set(f, (st.unresolvedIn.get(f) ?? 0) + 1); un.repoLike++; un.unresolved++; un.why[r.why] = (un.why[r.why] ?? 0) + 1; if (un.examples.length < 25) un.examples.push(`${f} -> ${im.spec}`); }
    }
    st.static.set(f, s); st.dynamic.set(f, d); (st.specCount ??= new Map()).set(f, list.filter((x) => x.spec).length);
  }
  stats[project] = { ...un, unresolvedRate: un.unresolved / un.repoLike };
  return st;
}
function closure(g, starts, withDynamic) {
  const seenS = new Set(starts), todo = [...starts];
  while (todo.length) {
    const m = todo.pop();
    for (const x of g.static.get(m) ?? []) if (!seenS.has(x)) { seenS.add(x); todo.push(x); }
    if (withDynamic) for (const x of g.dynamic.get(m) ?? []) if (!seenS.has(x)) { seenS.add(x); todo.push(x); }
  }
  return seenS;
}
const SETUP = {
  "node-unit": [W + "src/test-support/console-spies.ts", W + "src/test-support/audit-log-spy.ts", W + "src/test-support/cloudflare-global-stub.ts"],
  "workers-unit": [W + "src/test-support/console-spies.ts"],
};
// workers-unit: @cloudflare/vitest-pool-workers loads the wrangler `main` (packages/worker/wrangler.jsonc
// "main": "./src/index.ts") at runtime for tests that reach the worker's DOs/exports; no import edge shows it.
const MAIN = { "workers-unit": [W + "src/index.ts"] };
const TEST_RE = { "node-unit": /\.node\.test\.ts$/, "workers-unit": /\.workers\.test\.ts$/ };
const EXCL = /(^|\/)(node_modules|\.git|\.worktrees|\.tmp)\//;

function kindOf(p) {
  if (/\.md$/.test(p)) return "markdown (markdownAsText plugin)";
  if (/\.json$/.test(p)) return "json";
  if (/\.css$/.test(p)) return "css (?raw / css import)";
  if (/\.wasm$/.test(p)) return "wasm";
  if (/test-support\//.test(p)) return "test-support (ts)";
  return "ts/js module";
}
const quant = (a, q) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(q * (s.length - 1) + 0.5))] : 0; };
const sum = (a) => a.reduce((x, y) => x + y, 0);

const result = { commit, head, tree: shards[0].tree, verbatim, parseErrors: parseErr.length, projects: {} };
const perProject = {};
for (const project of Object.keys(PROJECTS)) {
  const obs = observed.get(project);
  if (!obs) continue;
  const g = graph(project);
  const setupC = closure(g, SETUP[project], true);
  const setupStatic = closure(g, SETUP[project], false);
  const mainC = MAIN[project] ? closure(g, MAIN[project], true) : new Set();
  const selMain = new Map(); const missMainKinds = {}, missMainPaths = new Map(); let missMainTotal = 0, missMainTests = 0;
  const reach = new Set(setupC);
  const testsOnDisk = tracked.filter((t) => TEST_RE[project].test(t) && !EXCL.test(t));
  const rows = [];
  const missKinds = {}, missPaths = new Map(), dynOnlyObserved = [], missTests = [];
  const selObs = new Map(), selStat = new Map(), selStatNoSetup = new Map(), selStaticOnly = new Map();
  const bump = (m, k) => m.set(k, (m.get(k) ?? 0) + 1);
  const closures = new Map(), staticClosures = new Map();
  for (const [t, o] of obs) {
    const sOnly = closure(g, [t], false), sd = closure(g, [t], true);
    const full = new Set([...sd, ...setupC]);
    closures.set(t, full); staticClosures.set(t, new Set([...sOnly, ...setupStatic]));
    for (const x of sd) reach.add(x);
    const withMain = new Set([...full, ...mainC]);
    let mm = 0;
    for (const p of o) if (!withMain.has(p)) { mm++; missMainKinds[kindOf(p)] = (missMainKinds[kindOf(p)] ?? 0) + 1; missMainPaths.set(p, (missMainPaths.get(p) ?? 0) + 1); }
    missMainTotal += mm; if (mm) missMainTests++;
    for (const p of withMain) selMain.set(p, (selMain.get(p) ?? 0) + 1);
    let miss = 0, dynOnly = 0;
    for (const p of o) {
      if (!full.has(p)) { miss++; missKinds[kindOf(p)] = (missKinds[kindOf(p)] ?? 0) + 1; bump(missPaths, p); }
      if (sd.has(p) && !sOnly.has(p) && !setupStatic.has(p)) dynOnly++;
    }
    if (miss) missTests.push(t);
    dynOnlyObserved.push(dynOnly);
    const inter = [...o].filter((p) => full.has(p)).length;
    rows.push({ t, obs: o.size, sOnly: sOnly.size, sd: sd.size, full: full.size, miss, inter, withMain: withMain.size, extra: full.size - inter });
    for (const p of o) bump(selObs, p);
    for (const p of full) bump(selStat, p);
    for (const p of sd) bump(selStatNoSetup, p);
    for (const p of sOnly) bump(selStaticOnly, p);
  }
  const col = (k) => rows.map((r) => r[k]);
  const summary = (k) => ({ median: quant(col(k), 0.5), p90: quant(col(k), 0.9), max: Math.max(...col(k)), mean: +(sum(col(k)) / rows.length).toFixed(1), total: sum(col(k)) });
  // closure for unmapped on-disk tests (for replay static side)
  for (const t of testsOnDisk) if (!closures.has(t)) closures.set(t, new Set([...closure(g, [t], true), ...setupC]));
  const unmapped = testsOnDisk.filter((t) => !obs.has(t));
  const mappedNotOnDisk = [...obs.keys()].filter((t) => !trackedSet.has(t));
  // ratio per test of full closure / observed
  const ratio = rows.map((r) => r.full / r.obs);
  result.projects[project] = {
    mappedTests: obs.size, testsOnDisk: testsOnDisk.length, unmapped, mappedNotOnDisk,
    setupClosure: setupC.size, setupStaticClosure: setupStatic.size, setupFiles: SETUP[project],
    observed: summary("obs"), staticOnly: summary("sOnly"), staticDynamic: summary("sd"), staticDynamicSetup: summary("full"),
    missing: summary("miss"), testsWithMiss: missTests.length, observedInClosure: summary("inter"),
    ratioFullOverObserved: { median: +quant(ratio, 0.5).toFixed(1), p10: +quant(ratio, 0.1).toFixed(1), p90: +quant(ratio, 0.9).toFixed(1) },
    observedReachedOnlyByDynamic: { median: quant(dynOnlyObserved, 0.5), total: sum(dynOnlyObserved), testsWithAny: dynOnlyObserved.filter(Boolean).length },
    missKinds, topMissPaths: [...missPaths].sort((a, b) => b[1] - a[1]).slice(0, 25),
    missPathCount: missPaths.size,
    resolution: stats[project],
    reachableResolution: (() => { let specs = 0, un = 0; const ex = []; for (const f of new Set([...reach, ...mainC])) { specs += g.specCount?.get(f) ?? 0; const u = g.unresolvedIn?.get(f) ?? 0; un += u; if (u) ex.push(f); } return { files: reach.size, specs, unresolved: un, rate: un / specs, files_with_unresolved: ex }; })(),
    extraOverObserved: summary("extra"),
    testsClosureWithin10pct: rows.filter((r) => r.full <= Math.ceil(r.obs * 1.1)).length,
    mainEntry: MAIN[project] ? { entry: MAIN[project], closure: mainC.size, withMain: summary("withMain"), missing: missMainTotal, testsWithMiss: missMainTests, missKinds: missMainKinds, topMissPaths: [...missMainPaths].sort((a, b) => b[1] - a[1]).slice(0, 10) } : null,
  };
  perProject[project] = { staticClosures, mainC, selMain, obs, closures, unmapped, selObs, selStat, selStatNoSetup, selStaticOnly, setupC, testsOnDisk: new Set(testsOnDisk) };
}

// ---- per source file: tests selecting it
const named = ["packages/worker/src/mcp/capabilities/execution-contexts/capabilities.ts", "packages/worker/src/mcp/capabilities/packages/publish-external-push.ts", "packages/worker/src/mcp/tools/search-tool-runner.ts"];
const allSources = new Set();
for (const p of Object.values(perProject)) { for (const k of p.selObs.keys()) allSources.add(k); for (const k of p.selStat.keys()) allSources.add(k); }
const isTestPath = (x) => /\.(node|workers)\.test\.ts$/.test(x);
const perSource = [];
for (const s of allSources) {
  if (isTestPath(s)) continue;
  const r = { s };
  for (const [proj, p] of Object.entries(perProject)) {
    r[proj] = { obs: p.selObs.get(s) ?? 0, static: p.selStaticOnly.get(s) ?? 0, sd: p.selStatNoSetup.get(s) ?? 0, full: p.selStat.get(s) ?? 0, withMain: p.mainC.size ? p.selMain.get(s) ?? 0 : undefined };
  }
  perSource.push(r);
}
result.named = named.map((n) => perSource.find((r) => r.s === n) ?? { s: n, missing: true });
// distribution over sources: sum of selections, and ratio buckets
for (const proj of Object.keys(perProject)) {
  const rs = perSource.filter((r) => r[proj].full > 0 || r[proj].obs > 0);
  const obsT = sum(rs.map((r) => r[proj].obs)), fullT = sum(rs.map((r) => r[proj].full)), sdT = sum(rs.map((r) => r[proj].sd));
  const codeRs = rs.filter((r) => CODE.test(r.s));
  result.projects[proj].perSource = {
    sources: rs.length,
    sumObserved: obsT, sumStaticDynamic: sdT, sumStaticDynamicSetup: fullT,
    medianObserved: quant(codeRs.map((r) => r[proj].obs), 0.5), medianFull: quant(codeRs.map((r) => r[proj].full), 0.5),
    observedOnly: rs.filter((r) => r[proj].obs > 0 && r[proj].full === 0).length,
    observedGreater: rs.filter((r) => r[proj].obs > r[proj].full).length,
    topGap: [...codeRs].sort((a, b) => (b[proj].full - b[proj].obs) - (a[proj].full - a[proj].obs)).slice(0, 12).map((r) => [r.s, r[proj].obs, r[proj].sd, r[proj].full]),
    topObsOverStatic: [...rs].sort((a, b) => (b[proj].obs - b[proj].full) - (a[proj].obs - a[proj].full)).slice(0, 10).map((r) => [r.s, r[proj].obs, r[proj].sd, r[proj].full]),
  };
}

// ---- replay on first-parent commits before the map commit
const log = git("log", "--first-parent", "--format=%H %s", `-${nCommits + 1}`, head).trim().split("\n").slice(1);
const globalHook = (path) => {
  const b = path.slice(path.lastIndexOf("/") + 1);
  return /^(?:package(?:-lock)?\.json|vitest.*\.ts|vite\.config\.ts|tsconfig.*|wrangler.*\.jsonc|nx\.json|project\.json)$/.test(b) || path.startsWith("tools/vitest-global-setup") || path.startsWith("patches/") || /(?:^|\/)migrations(?:\/|$)/.test(path);
};
const docsOnly = (p) => p.startsWith("docs/") || /\.(md|mdx)$/i.test(p) || /^(LICENSE|COPYING)/i.test(p.slice(p.lastIndexOf("/") + 1));
const replay = [];
const anyObserved = new Set(); for (const p of Object.values(perProject)) for (const s of p.selObs.keys()) anyObserved.add(s);
const anyClosure = new Set(); for (const p of Object.values(perProject)) for (const s of p.selStat.keys()) anyClosure.add(s);
const escapeCats = {
  "package.json / package-lock.json": (p) => /(^|\/)package(-lock)?\.json$/.test(p),
  "patches/": (p) => p.startsWith("patches/"),
  ".env files": (p) => /(^|\/)\.env/.test(p) || /\.env(\.|$)/.test(p.slice(p.lastIndexOf("/") + 1)),
  "wrangler config": (p) => /(^|\/)wrangler[^/]*\.(jsonc?|toml)$/.test(p),
  "D1 migrations (workers-unit reads them in config)": (p) => /(^|\/)(audit-)?migrations\//.test(p),
  "vitest/vite config or plugin (main process)": (p) => /(^|\/)vitest[^/]*\.ts$/.test(p) || /(^|\/)vite\.config\.ts$/.test(p) || /^tools\/vite-[^/]*\.ts$/.test(p),
  "globalSetup tools/vitest-global-setup-*": (p) => p.startsWith("tools/vitest-global-setup"),
  "tsconfig": (p) => /(^|\/)tsconfig[^/]*\.json$/.test(p),
  "other non-code not observed (json/md/sql/css/yaml...)": null,
};
for (const line of log) {
  const sha = line.slice(0, 40), subj = line.slice(41);
  let changed;
  try { changed = git("diff", "--name-only", "--no-renames", `${sha}^`, sha).split("\n").filter(Boolean); } catch { continue; }
  const r = { sha: sha.slice(0, 10), subj: subj.slice(0, 70), files: changed.length, projects: {}, escapes: {}, mdOnlyLoaded: false };
  for (const [proj, p] of Object.entries(perProject)) {
    const ch = new Set(changed);
    let mainSel = 0, mainNotObs = 0, obsNotMain = 0, sOnlySel = 0, obsNotSOnly = 0;
    const mainHit = changed.some((c) => p.mainC.has(c));
    let obsSel = 0, statSel = 0, obsUnmapped = 0, both = 0, obsNotStat = 0, statNotObs = 0;
    const setupHit = changed.some((c) => p.setupC.has(c));
    for (const t of p.testsOnDisk) {
      const o = p.obs.get(t);
      const so = !o ? (obsUnmapped++, true) : ch.has(t) || changed.some((c) => o.has(c));
      const ss = ch.has(t) || setupHit || changed.some((c) => p.closures.get(t)?.has(c));
      const sso = ch.has(t) || changed.some((c) => p.staticClosures.get(t)?.has(c));
      if (sso) sOnlySel++; if (so && o && !sso) obsNotSOnly++;
      const sm = ss || mainHit; if (sm) mainSel++; if (sm && !so) mainNotObs++; if (so && !sm) obsNotMain++;
      if (so) obsSel++; if (ss) statSel++; if (so && ss) both++; if (so && !ss) obsNotStat++; if (ss && !so) statNotObs++;
    }
    r.projects[proj] = { ...(p.mainC.size ? { mainSel, mainNotObs, obsNotMain, mainHit } : {}), sOnlySel, obsNotSOnly, obsSel, obsSelMappedOnly: obsSel - obsUnmapped, statSel, obsNotStat, statNotObs, setupHit };
  }
  for (const c of changed) {
    if (CODE.test(c) && !/^tools\/vite-|vitest[^/]*\.ts$|vite\.config\.ts$/.test(c)) continue;
    if (anyObserved.has(c)) continue;
    let cat = null;
    for (const [k, f] of Object.entries(escapeCats)) if (f && f(c)) { cat = k; break; }
    if (!cat) { if (CODE.test(c)) continue; if (docsOnly(c) && !c.startsWith("packages/")) continue; cat = "other non-code not observed (json/md/sql/css/yaml...)"; }
    (r.escapes[cat] ??= []).push(c);
  }
  // a push of only docs-only paths skips unit tests in Kody's hook; does any of them sit in an observed set?
  r.docsOnlyPush = changed.every(docsOnly);
  r.docsOnlyButLoaded = r.docsOnlyPush && changed.some((c) => anyObserved.has(c));
  r.globalHook = changed.filter(globalHook);
  r.changedLoaded = changed.filter((c) => anyObserved.has(c) && !CODE.test(c));
  replay.push(r);
}
result.replay = replay;
writeFileSync(out, JSON.stringify(result, null, 1));
console.log("wrote", out);
