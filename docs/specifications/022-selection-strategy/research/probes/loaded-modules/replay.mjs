// Throwaway probe for research/loaded-modules.md (Q1, Q4, Q5).
// Replays real runs in a copy of a Squeal store: for each test file run in a
// worktree, the paths changed since its previous run there (union of the
// revisions in between, only when every one is in the store), and whether a
// "loaded set" rule would have run it. The loaded set is the coverage record
// of the previous run's result key (code.sqlite), i.e. the in-process modules
// Squeal's provider saw. Usage:
//   node replay.mjs <store.sqlite> <code.sqlite> <squeal.config.json> <since-ms> <out.json>
import { readFileSync, writeFileSync } from "node:fs";
import { matchesGlob } from "node:path";
import { open, loadedPaths, inflateJson } from "./lib.mjs";

const [storePath, codePath, configPath, sinceArg, outPath] = process.argv.slice(2);
const since = Number(sinceArg);
const s = open(storePath);
const c = open(codePath);
const config = JSON.parse(readFileSync(configPath, "utf8"));

// ---- declared inputs (policy `inputs`, map or list)
const inputs = config.inputs ?? {};
const declaredRules = Array.isArray(inputs)
  ? [{ test: "**", globs: inputs }]
  : Object.entries(inputs).map(([test, globs]) => ({ test, globs }));
const declaredHit = (testPath, p) =>
  declaredRules.some((r) => matchesGlob(testPath, r.test) && r.globs.some((g) => matchesGlob(p, g)));

// ---- observed maps (merged, never pruned; the newest view)
const observed = {}; // kind -> project -> test -> Set
for (const row of s.prepare("select key, value from meta where key like 'observed%.%'").all()) {
  const [kind, ...rest] = row.key.split(".");
  const project = rest.join(".");
  let map;
  try { map = JSON.parse(row.value); } catch { continue; }
  if (Array.isArray(map)) continue; // observedStartup.*: a list
  observed[kind] ??= {};
  observed[kind][project] = new Map(Object.entries(map).map(([t, ps]) => [t, new Set(ps)]));
}
const obs = (kind, project, test) => observed[kind]?.[project]?.get(test) ?? new Set();

// ---- revisions per worktree
const revs = new Map(); // wt -> Map(number -> {changes, trigger})
for (const r of s.prepare("select worktree_id, number, trigger, changes, created_at from revisions").all()) {
  if (!revs.has(r.worktree_id)) revs.set(r.worktree_id, new Map());
  let changes;
  try { changes = JSON.parse(r.changes); } catch { changes = null; }
  revs.get(r.worktree_id).set(r.number, { changes, trigger: r.trigger, at: r.created_at });
}

// ---- runs of test files: one row per (run, project, test file)
const fileRows = s.prepare(`
  select r.worktree_id wt, r.revision rev, r.run_id run, ch.project project, ch.test_path test,
         max(case when ch.kind='file' then r.key end) key,
         max(case when ch.kind='file' then r.outcome end) fileOutcome,
         max(case when ch.kind='file' then r.duration_ms end) fileMs,
         sum(case when ch.kind='test' then r.duration_ms else 0 end) testMs,
         sum(r.outcome='fail') fails,
         min(r.recorded_at) at,
         ru.checkpoint_id cp
  from results r join checks ch on ch.id = r.check_id join runs ru on ru.id = r.run_id
  where r.recorded_at >= ? and ru.worktree_id = r.worktree_id
  group by r.run_id, ch.project, ch.test_path`).all(since - 7 * 86400e3);
console.error("rows", fileRows.length);

const coverageKeys = new Set(c.prepare("select result_key from coverage").all().map((r) => r.result_key));
const coverageOf = c.prepare("select record from coverage where result_key = ? order by provider_version desc limit 1");
const importsOf = s.prepare("select environment, imports from test_file_imports where project = ? and path = ? and key = ?");
const envOf = s.prepare("select files, imports from environment_walks where project = ? and environment = ?");
const flatClosure = s.prepare("select closure_paths from test_files where project = ? and path = ?");
const nearestKey = s.prepare("select key from test_file_imports where project = ? and path = ? order by recorded_at desc limit 1");
const coverageExclude = config.coverage?.exclude ?? [];
const excluded = (p) => coverageExclude.some((g) => matchesGlob(p, g));
const ancestors = (p) => { const out = ["./"]; for (let i = p.indexOf("/"); i >= 0; i = p.indexOf("/", i + 1)) out.push(p.slice(0, i) + "/"); return out; };
const loadedCache = new Map();
const loaded = (key) => {
  if (!loadedCache.has(key)) {
    const row = coverageOf.get(key);
    loadedCache.set(key, row ? new Set(loadedPaths(row.record).paths) : null);
  }
  return loadedCache.get(key);
};
const graphCache = new Map();
/** The walked graph of a key: static and dynamic reach from the test file, and the environment's files. */
function graph(project, test, key) {
  const id = `${project}\0${test}\0${key}`;
  if (graphCache.has(id)) return graphCache.get(id);
  let out = null;
  const row = key && importsOf.get(project, test, key);
  if (row) {
    const edges = new Map(inflateJson(row.imports).map(([p, st, dy]) => [p, { st, dy }]));
    const reach = (withDynamic) => {
      const seen = new Set([test]);
      const stack = [test];
      while (stack.length) {
        const e = edges.get(stack.pop());
        if (!e) continue;
        for (const t of withDynamic ? [...e.st, ...e.dy] : e.st) if (!seen.has(t)) { seen.add(t); stack.push(t); }
      }
      return seen;
    };
    const env = envOf.get(project, row.environment);
    out = { staticReach: reach(false), allReach: reach(true), walked: new Set(edges.keys()), envFiles: new Set(env ? JSON.parse(env.files) : []) };
  }
  graphCache.set(id, out);
  return out;
}
const MODULE = /\.(c|m)?(j|t)sx?$/;

// ---- pair consecutive runs per (worktree, project, test)
const byFile = new Map();
for (const r of fileRows) {
  const id = `${r.wt}\0${r.project}\0${r.test}`;
  if (!byFile.has(id)) byFile.set(id, []);
  byFile.get(id).push(r);
}
const pairs = [];
const counts = { files: byFile.size, firstRuns: 0, sameRevision: 0, gap: 0, considered: 0 };
for (const runs of byFile.values()) {
  runs.sort((a, b) => a.at - b.at);
  for (let i = 0; i < runs.length; i++) {
    const cur = runs[i];
    if (cur.at < since || cur.cp) continue;
    if (i === 0) { counts.firstRuns++; continue; }
    const prev = runs[i - 1];
    if (cur.rev === prev.rev) { counts.sameRevision++; continue; }
    const wrevs = revs.get(cur.wt);
    const changed = new Map();
    let complete = true;
    for (let n = prev.rev + 1; n <= cur.rev; n++) {
      const rv = wrevs?.get(n);
      if (!rv || !Array.isArray(rv.changes)) { complete = false; break; }
      for (const ch of rv.changes) changed.set(ch.path, ch);
    }
    if (!complete) { counts.gap++; continue; }
    counts.considered++;
    pairs.push({ prev, cur, changed });
  }
}
console.error(counts);

// ---- classify
const IN_CLOSURE = ["test", "loaded", "excludedFromRecord", "setupConfig", "staticNotLoaded", "dynamicOnly", "walkedOther", "flatModule", "flatNonModule", "childProcess", "observedRead", "declared", "listing"];
const out = [];
for (const { prev, cur, changed } of pairs) {
  const { project, test } = cur;
  const L = prev.key && coverageKeys.has(prev.key) ? loaded(prev.key) : null;
  let graphFrom = "key";
  let g = graph(project, test, prev.key);
  if (!g) { g = graph(project, test, cur.key); graphFrom = "curKey"; }
  if (!g) { const k = nearestKey.get(project, test)?.key; g = k ? graph(project, test, k) : null; graphFrom = g ? "nearestKey" : "flat"; }
  const flat = new Set(JSON.parse(flatClosure.get(project, test)?.closure_paths ?? "[]"));
  const observedAll = new Set([...obs("observed", project, test)]);
  const kinds = {};
  const add = (k, p) => (kinds[k] ??= []).push(p);
  for (const [p, ch] of changed) {
    const inImports = g ? g.allReach.has(p) : flat.has(p);
    if (p === test) add("test", p);
    else if (L?.has(p)) add("loaded", p);
    else if (inImports && excluded(p)) add("excludedFromRecord", p);
    else if (g?.envFiles.has(p)) add("setupConfig", p);
    else if (g?.staticReach.has(p)) add("staticNotLoaded", p);
    else if (g?.allReach.has(p)) add("dynamicOnly", p);
    else if (g?.walked.has(p)) add("walkedOther", p);
    else if (obs("observedDirect", project, test).has(p) || obs("observedModules", project, test).has(p)) add("childProcess", p);
    else if (observedAll.has(p)) add("observedRead", p);
    else if (declaredHit(test, p)) add("declared", p);
    else if (flat.has(p)) add(MODULE.test(p) ? "flatModule" : "flatNonModule", p);
    else if ((!ch.oldHash || !ch.newHash) && ancestors(p).some((a) => observedAll.has(a) || flat.has(a))) add("listing", p);
    else add("outside", p);
  }
  const today = IN_CLOSURE.some((k) => kinds[k]);
  const ms = cur.fileMs ?? cur.testMs ?? 0;
  const failedNow = cur.fails > 0 || cur.fileOutcome === "fail";
  const failedBefore = prev.fails > 0 || prev.fileOutcome === "fail";
  // S1: the pure rule (a path the record cannot hold, by coverage.exclude, counts as loaded).
  // S2: only the import-graph part of the closure narrows to the loaded set; setup, config,
  // child-process, observed, declared, listing and non-module closure paths keep re-running.
  const s1 = L === null ? "noSet" : kinds.test || kinds.loaded || kinds.excludedFromRecord ? "run" : "skip";
  const keep2 = ["test", "loaded", "excludedFromRecord", "setupConfig", "childProcess", "observedRead", "declared", "flatNonModule", "listing", "walkedOther"];
  const s2 = L === null ? "noSet" : keep2.some((k) => kinds[k]) ? "run" : "skip";
  out.push({
    wt: cur.wt, project, test, prevRev: prev.rev, rev: cur.rev, ms, failedNow, failedBefore,
    hasSet: L !== null, setSize: L?.size ?? null, graph: graphFrom,
    today, s1, s2, kinds: Object.fromEntries(Object.entries(kinds).map(([k, v]) => [k, v.length])),
    paths: Object.fromEntries(Object.entries(kinds).map(([k, v]) => [k, v.slice(0, 3)])),
    nChanged: changed.size,
  });
}
writeFileSync(outPath, JSON.stringify({ counts, pairs: out }));
console.error("pairs", out.length);
