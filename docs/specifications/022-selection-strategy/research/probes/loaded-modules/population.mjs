// Throwaway probe for research/loaded-modules.md (Q1, Q4): population replay.
// Every test file with a coverage record (its newest) against every stored
// revision's changed paths: which test files today's closure re-keys, which a
// loaded-set rule would run (S1 pure; S2 = loaded set for the import graph,
// today's rule for every other closure path), weighted by median recorded
// seconds. Usage: node population.mjs <store> <code> <config> <out.json>
import { readFileSync, writeFileSync } from "node:fs";
import { matchesGlob } from "node:path";
import { open, loadedPaths, inflateJson } from "./lib.mjs";

const [storePath, codePath, configPath, outPath] = process.argv.slice(2);
const s = open(storePath), c = open(codePath);
const config = JSON.parse(readFileSync(configPath, "utf8"));
const inputs = config.inputs ?? {};
const rules = Array.isArray(inputs) ? [{ test: "**", globs: inputs }] : Object.entries(inputs).map(([test, globs]) => ({ test, globs }));
const coverageExclude = config.coverage?.exclude ?? [];
const excluded = (p) => coverageExclude.some((g) => matchesGlob(p, g));
const MODULE = /\.(c|m)?(j|t)sx?$/;

const observed = {};
for (const row of s.prepare("select key, value from meta where key like 'observed%.%'").all()) {
  const [kind, ...rest] = row.key.split(".");
  let map; try { map = JSON.parse(row.value); } catch { continue; }
  if (Array.isArray(map)) continue;
  (observed[kind] ??= {})[rest.join(".")] = map;
}
const obs = (kind, project, test) => observed[kind]?.[project]?.[test] ?? [];

// newest coverage-bearing key per test file, and median seconds
const coverageKeys = new Set(c.prepare("select result_key from coverage").all().map((r) => r.result_key));
const fileResults = s.prepare(`select ch.project, ch.test_path test, r.key, r.recorded_at at, r.duration_ms ms
  from results r join checks ch on ch.id = r.check_id where ch.kind = 'file'`).all();
const tests = new Map();
for (const r of fileResults) {
  const id = `${r.project}\0${r.test}`;
  const t = tests.get(id) ?? { project: r.project, test: r.test, ms: [], key: null, at: 0 };
  t.ms.push(r.ms);
  if (coverageKeys.has(r.key) && r.at > t.at) { t.key = r.key; t.at = r.at; }
  tests.set(id, t);
}
const coverageOf = c.prepare("select record from coverage where result_key = ? order by provider_version desc limit 1");
const importsOf = s.prepare("select environment, imports from test_file_imports where project = ? and path = ? order by recorded_at desc limit 1");
const envOf = s.prepare("select files from environment_walks where project = ? and environment = ?");
const flatOf = s.prepare("select closure_paths from test_files where project = ? and path = ?");
const files = [];
let noRecord = 0, noGraph = 0;
const noGraphRunner = {};
for (const t of tests.values()) {
  t.ms.sort((a, b) => a - b);
  const sec = (t.ms[Math.floor(t.ms.length / 2)] ?? 0) / 1000;
  const row = importsOf.get(t.project, t.test);
  let importReach = null, env = [];
  if (row) {
    const edges = new Map(inflateJson(row.imports).map(([p, st, dy]) => [p, [...st, ...dy]]));
    importReach = new Set([t.test]);
    const stack = [t.test];
    while (stack.length) for (const x of edges.get(stack.pop()) ?? []) if (!importReach.has(x)) { importReach.add(x); stack.push(x); }
    env = JSON.parse(envOf.get(t.project, row.environment)?.files ?? "[]");
  } else noGraph++;
  const flat = JSON.parse(flatOf.get(t.project, t.test)?.closure_paths ?? "[]");
  const declared = rules.filter((r) => matchesGlob(t.test, r.test)).flatMap((r) => r.globs);
  if (!importReach) noGraphRunner[t.project] = (noGraphRunner[t.project] ?? 0) + 1;
  const envSet = new Set(env);
  const child = new Set([...obs("observedDirect", t.project, t.test), ...obs("observedModules", t.project, t.test)]);
  const read = new Set(obs("observed", t.project, t.test));
  const other = new Set([...env, ...read, ...child]);
  // No stored graph (node:test, pytest, older keys): the flat closure's module paths, less what a declared glob names.
  const imports = importReach ?? new Set(flat.filter((p) => MODULE.test(p) && !other.has(p) && !declared.some((g) => matchesGlob(p, g))));
  const flatOnly = new Set();
  for (const p of flat) if (!imports.has(p) && !other.has(p)) { other.add(p); flatOnly.add(p); }
  const L = t.key ? new Set(loadedPaths(coverageOf.get(t.key).record).paths) : null;
  if (!L) noRecord++;
  files.push({ ...t, ms: undefined, sec, imports, other, declared, L, envSet, child, read, flatOnly });
}
console.error("test files", files.length, "no record", noRecord, "no stored graph", noGraph, noGraphRunner);

const revisions = s.prepare("select worktree_id, number, trigger, changes from revisions").all()
  .map((r) => ({ ...r, paths: (() => { try { return JSON.parse(r.changes).map((x) => x.path); } catch { return []; } })() }))
  .filter((r) => r.paths.length > 0);
const totals = { revisions: revisions.length, suiteSec: files.reduce((a, f) => a + f.sec, 0) };
const agg = { today: [0, 0], s1: [0, 0], s2: [0, 0], s1NotToday: [0, 0], noRecordToday: [0, 0] };
const kindSec = {};
const notLoadedEx = new Map(), readEx = new Map(), addedEx = new Map();
const watch = { today: 0, s1: 0, s2: 0 };
const perRevision = [];
for (const rv of revisions) {
  const P = rv.paths;
  const r = { today: 0, s1: 0, s2: 0, n: P.length, trigger: rv.trigger };
  for (const f of files) {
    const self = P.includes(f.test);
    const hitImports = P.filter((p) => f.imports.has(p));
    const hitOther = P.filter((p) => f.other.has(p) || f.declared.some((g) => matchesGlob(p, g)));
    const today = self || hitImports.length > 0 || hitOther.length > 0;
    if (!f.L) { if (today) { agg.noRecordToday[0]++; agg.noRecordToday[1] += f.sec; } continue; }
    const hitLoaded = P.filter((p) => f.L.has(p) || (excluded(p) && f.imports.has(p)));
    const s1 = self || hitLoaded.length > 0;
    const s2 = s1 || hitOther.length > 0;
    if (today) { agg.today[0]++; agg.today[1] += f.sec; r.today += f.sec; }
    if (s1) { agg.s1[0]++; agg.s1[1] += f.sec; r.s1 += f.sec; }
    if (s2) { agg.s2[0]++; agg.s2[1] += f.sec; r.s2 += f.sec; }
    if (s1 && !today) { agg.s1NotToday[0]++; agg.s1NotToday[1] += f.sec; for (const p of hitLoaded) addedEx.set(p, (addedEx.get(p) ?? 0) + 1); }
    if (rv.trigger === "watch") { if (today) watch.today += f.sec; if (s1) watch.s1 += f.sec; if (s2) watch.s2 += f.sec; }
    if (today && !s1) {
      // why today ran it: the strongest reason among the hit paths
      const k = hitImports.length ? "importNotLoaded" : hitOther.some((p) => f.envSet.has(p)) ? "setupConfig" : hitOther.some((p) => f.child.has(p)) ? "childProcess"
        : hitOther.some((p) => f.read.has(p)) ? "observedRead" : hitOther.some((p) => f.declared.some((g) => matchesGlob(p, g))) ? "declared"
        : hitOther.some((p) => f.flatOnly.has(p) && MODULE.test(p)) ? "flatOnlyModule" : "flatOnlyNonModule";
      if (rv.trigger === "watch") kindSec["watch:" + k] = (kindSec["watch:" + k] ?? 0) + f.sec;
      if (k === "importNotLoaded") for (const p of hitImports) notLoadedEx.set(p, (notLoadedEx.get(p) ?? 0) + 1);
      if (k === "observedRead") for (const p of hitOther.filter((p) => f.read.has(p))) readEx.set(p, (readEx.get(p) ?? 0) + 1);
      kindSec[k] = (kindSec[k] ?? 0) + f.sec;
    }
  }
  perRevision.push(r);
}
const round = ([n, s]) => ({ runs: n, sec: Math.round(s) });
const summary = { totals: { ...totals, suiteSec: Math.round(totals.suiteSec), files: files.length, noRecord, noGraph }, agg: Object.fromEntries(Object.entries(agg).map(([k, v]) => [k, round(v)])), todayNotS1BySec: Object.fromEntries(Object.entries(kindSec).map(([k, v]) => [k, Math.round(v)])) };
const med = (xs) => { const a = [...xs].sort((x, y) => x - y); return a[Math.floor(a.length / 2)]; };
summary.median = { today: med(perRevision.map((r) => r.today)), s1: med(perRevision.map((r) => r.s1)), s2: med(perRevision.map((r) => r.s2)) };
const wide = perRevision.filter((r) => r.today > 0.25 * totals.suiteSec);
summary.wide = { revisions: wide.length, today: Math.round(wide.reduce((a, r) => a + r.today, 0)), s1: Math.round(wide.reduce((a, r) => a + r.s1, 0)), s2: Math.round(wide.reduce((a, r) => a + r.s2, 0)) };
summary.watch = Object.fromEntries(Object.entries(watch).map(([k, v]) => [k, Math.round(v)]));
summary.watchRevisions = revisions.filter((r) => r.trigger === "watch").length;
const top = (m) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
summary.examples = { importNotLoaded: top(notLoadedEx), observedRead: top(readEx), addedByLoaded: top(addedEx) };
console.log(JSON.stringify(summary, null, 1));
writeFileSync(outPath, JSON.stringify({ summary, perRevision }));
