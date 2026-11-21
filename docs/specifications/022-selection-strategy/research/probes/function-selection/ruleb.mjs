// Throwaway probe for research/function-selection.md (Q5): recorded new
// failures in edit revisions, against rule B's set and an emulation of
// today's edit cut (src/core/scheduler/edit-cut.ts `editWork`, tierSize 4).
// A new failure: a test file's run in one worktree fails (a failed test or
// file) after its previous run there passed, and every revision between is a
// stored `watch` revision without a HEAD move. The edit is the union of those
// revisions' changes. Rule B: the test files whose pre-edit record (latest
// own result before the edit with a record; else the newest record of the
// file whose bytes match the old contents on the changed paths it holds)
// entered a changed function. Usage:
//   node --import tsx ruleb.mjs <store> <code> <git-dir> <since-ms> <config.json> <out.json>
import { writeFileSync, readFileSync } from "node:fs";
import { matchesGlob } from "node:path";
import { createHash } from "node:crypto";
import { inflateRawSync, constants } from "node:zlib";
import { open, coverageReader, blobReader, median } from "./lib.mjs";
import { judge, isScript } from "./structure.mjs";
import { namesakesOf } from "../../../../../../src/core/scheduler/namesakes.ts";

const [storePath, codePath, gitDir, sinceArg, configPath, outPath] = process.argv.slice(2);
const since = Number(sinceArg);
const TIER = 4;
const s = open(storePath);
const cov = coverageReader(codePath);
const blobs = blobReader(gitDir);
const config = JSON.parse(readFileSync(configPath, "utf8"));
const inputs = config.inputs ?? {};
const declaredRules = Array.isArray(inputs) ? [{ test: "**", globs: inputs }] : Object.entries(inputs).map(([test, globs]) => ({ test, globs: [globs].flat() }));
const inflate = (b) => JSON.parse(inflateRawSync(b, { finishFlush: constants.Z_SYNC_FLUSH }).toString("utf8"));
const observed = {};
for (const row of s.prepare("select key, value from meta where key like 'observed%.%'").all()) {
  const [kind, ...rest] = row.key.split(".");
  let map; try { map = JSON.parse(row.value); } catch { continue; }
  if (!Array.isArray(map)) (observed[kind] ??= {})[rest.join(".")] = map;
}
const obs = (kind, project, test) => observed[kind]?.[project]?.[test] ?? [];

const checks = s.prepare("select id, project, test_path from checks where kind = 'file'").all();
const checkOf = new Map(checks.map((c) => [c.id, c]));
const idOf = new Map(checks.map((c) => [`${c.project}\0${c.test_path}`, c.id]));
const fails = new Map(); // run \0 project \0 test -> failed test count
for (const r of s.prepare("select r.run_id run, ch.project, ch.test_path test, count(*) n from results r join checks ch on ch.id = r.check_id where ch.kind = 'test' and r.outcome = 'fail' and r.recorded_at >= ? group by 1, 2, 3").iterate(since - 14 * 86400e3)) fails.set(`${r.run}\0${r.project}\0${r.test}`, r.n);
const byWtCheck = new Map();
const durations = new Map();
for (const r of s.prepare("select check_id, worktree_id wt, revision rev, recorded_at at, key, outcome, duration_ms ms, run_id run from results where check_id in (select id from checks where kind='file') and recorded_at >= ?").iterate(since - 14 * 86400e3)) {
  const id = `${r.wt}\0${r.check_id}`;
  if (!byWtCheck.has(id)) byWtCheck.set(id, []);
  byWtCheck.get(id).push(r);
  if (!durations.has(r.check_id)) durations.set(r.check_id, []);
  durations.get(r.check_id).push(r.ms);
}
for (const l of byWtCheck.values()) l.sort((a, b) => a.at - b.at);
const ms = new Map([...durations].map(([k, v]) => [k, median(v)]));
const recordedByCheck = new Map();
for (const l of byWtCheck.values()) for (const r of l) if (cov.has(r.key)) { if (!recordedByCheck.has(r.check_id)) recordedByCheck.set(r.check_id, []); recordedByCheck.get(r.check_id).push(r); }
for (const l of recordedByCheck.values()) l.sort((a, b) => a.at - b.at);
const failed = (r) => r.outcome === "fail" || (fails.get(`${r.run}\0${checkOf.get(r.check_id).project}\0${checkOf.get(r.check_id).test_path}`) ?? 0) > 0;

// closures, direct imports, declared
const envOf = s.prepare("select files from environment_walks where project = ? and environment = ?");
const nearestImports = s.prepare("select environment, imports from test_file_imports where project = ? and path = ? order by recorded_at desc limit 1");
const closures = new Map(), direct = new Map(), envFiles = new Map(), reverse = new Map();
for (const t of s.prepare("select project, path, closure_paths from test_files").all()) {
  const id = idOf.get(`${t.project}\0${t.path}`);
  if (id === undefined) continue;
  const set = new Set([t.path, ...JSON.parse(t.closure_paths)]);
  const row = nearestImports.get(t.project, t.path);
  const d = new Set(), e = new Set();
  if (row) {
    for (const [p, st, dy] of inflate(row.imports)) { set.add(p); for (const x of [...st, ...dy]) { set.add(x); if (p === t.path) d.add(x); } }
    const env = envOf.get(t.project, row.environment);
    if (env) for (const f of JSON.parse(env.files)) { set.add(f); e.add(f); }
  }
  for (const k of ["observed", "observedDirect", "observedModules"]) for (const p of obs(k, t.project, t.path)) set.add(p);
  closures.set(id, set); direct.set(id, d); envFiles.set(id, e);
  for (const p of set) { if (!reverse.has(p)) reverse.set(p, new Set()); reverse.get(p).add(id); }
}
for (const r of declaredRules) r.ids = new Set([...closures.keys()].filter((id) => matchesGlob(checkOf.get(id).test_path, r.test)));
const declaredIds = (p) => { const ids = new Set(); for (const r of declaredRules) if (r.globs.some((g) => matchesGlob(p, g))) for (const id of r.ids) ids.add(id); return ids; };
const allTestPaths = [...closures.keys()].map((id) => checkOf.get(id).test_path);
const byPath = new Map(); for (const id of closures.keys()) { const p = checkOf.get(id).test_path; if (!byPath.has(p)) byPath.set(p, []); byPath.get(p).push(id); }

// revisions
const revs = new Map();
for (const r of s.prepare("select worktree_id wt, number, created_at at, trigger, head, changes from revisions").all()) {
  if (!revs.has(r.wt)) revs.set(r.wt, new Map());
  let changes; try { changes = JSON.parse(r.changes); } catch { changes = null; }
  revs.get(r.wt).set(r.number, { ...r, changes });
}
const isEdit = (wt, n) => { const m = revs.get(wt); const r = m?.get(n), p = m?.get(n - 1); return !!r && !!p && r.trigger === "watch" && Array.isArray(r.changes) && p.head === r.head; };

// new failures
const events = [];
let newFailures = 0;
for (const [id, list] of byWtCheck) {
  for (let i = 1; i < list.length; i++) {
    const prev = list[i - 1], cur = list[i];
    if (cur.at < since || failed(prev) || !failed(cur) || cur.rev <= prev.rev) continue;
    newFailures++;
    // edit-only: every revision between is an edit; stored: every revision between is stored (RULEB_ALL=1)
    let editOnly = true, stored = true;
    for (let n = prev.rev + 1; n <= cur.rev; n++) {
      const r = revs.get(cur.wt)?.get(n);
      if (!r || !Array.isArray(r.changes)) stored = false;
      if (!isEdit(cur.wt, n)) editOnly = false;
    }
    if (editOnly || (process.env.RULEB_ALL && stored)) events.push({ wt: cur.wt, check: cur.check_id, from: prev.rev + 1, to: cur.rev, at: revs.get(cur.wt).get(prev.rev + 1).at, editOnly });
  }
}
console.error("new failures", newFailures, "in edit revisions", events.length);

// one edit per (worktree, span): several failing files can share it
const edits = new Map();
for (const e of events) { const k = `${e.wt}\0${e.from}\0${e.to}`; if (!edits.has(k)) edits.set(k, { ...e, failing: [] }); edits.get(k).failing.push(e.check); }
const judgeCache = new Map();
const out = [];
for (const e of edits.values()) {
  const changed = new Map();
  for (let n = e.from; n <= e.to; n++) for (const ch of revs.get(e.wt).get(n).changes) { const was = changed.get(ch.path); changed.set(ch.path, { oldHash: was ? was.oldHash : ch.oldHash, newHash: ch.newHash }); }
  for (const [p, ch] of changed) if (ch.oldHash === ch.newHash) changed.delete(p);
  const reached = new Set();
  for (const p of changed.keys()) { for (const id of reverse.get(p) ?? []) reached.add(id); for (const id of declaredIds(p)) reached.add(id); }
  // ---- today's cut, emulated
  const changedTests = [...reached].filter((id) => changed.has(checkOf.get(id).test_path));
  const sources = [...changed.keys()].filter((p) => !byPath.has(p) && reverse.has(p));
  const directIds = new Set([...reached].filter((id) => changed.has(checkOf.get(id).test_path) || [...direct.get(id)].some((p) => changed.has(p)) || obs("observedDirect", checkOf.get(id).project, checkOf.get(id).test_path).some((p) => changed.has(p))));
  const kept = new Set(changedTests);
  for (const src of sources) {
    const own = namesakesOf(src, allTestPaths).flatMap((p) => byPath.get(p) ?? []).filter((id) => reached.has(id));
    const fallback = [...reached].filter((id) => direct.get(id).has(src));
    for (const id of own.length ? own : fallback) kept.add(id);
  }
  const declaredOnly = (id) => [...changed.keys()].every((p) => !closures.get(id).has(p));
  const shortest = (ids) => ids.sort((a, b) => (ms.get(a) ?? Infinity) - (ms.get(b) ?? Infinity) || a - b);
  const others = [...shortest([...directIds].filter((id) => !kept.has(id))), ...shortest([...reached].filter((id) => !kept.has(id) && !directIds.has(id) && !declaredOnly(id)))];
  for (const id of others.slice(0, TIER)) kept.add(id);
  // ---- rule B
  const B = new Set(), noRecord = new Set();
  const want = [];
  const plan = [];
  for (const id of reached) {
    const held = [...changed].filter(([p, ch]) => closures.get(id).has(p) || declaredIds(p).has(id));
    const scripts = held.filter(([p]) => isScript(p));
    let key = null;
    const own = (byWtCheck.get(`${e.wt}\0${id}`) ?? []).filter((x) => x.rev < e.from && x.at < e.at).at(-1);
    if (own && cov.has(own.key)) key = own.key;
    if (key) { const rec = cov.record(key); if (!scripts.every(([p, ch]) => !rec.sources.has(p) || rec.sources.get(p).blob === ch.oldHash)) key = null; }
    if (!key) for (const x of (recordedByCheck.get(id) ?? []).filter((x) => x.at < e.at).slice(-30).reverse()) {
      const rec = cov.record(x.key);
      if (rec && scripts.every(([p, ch]) => !rec.sources.has(p) || rec.sources.get(p).blob === ch.oldHash)) { key = x.key; break; }
    }
    if (!key) { noRecord.add(id); continue; }
    plan.push([id, key, scripts]);
    for (const [, ch] of scripts) want.push(ch.oldHash, ch.newHash);
  }
  blobs.prefetch(want.filter(Boolean));
  for (const [id, key, scripts] of plan) {
    const rec = cov.record(key);
    let entered = false, unknown = false;
    for (const [p, ch] of scripts) {
      if (!rec.sources.has(p) || !ch.newHash) continue;
      const a = blobs.get(ch.oldHash), b = blobs.get(ch.newHash);
      if (a == null || b == null) { unknown = true; continue; }
      const src = rec.sources.get(p);
      const k = `${p}\0${ch.oldHash}\0${ch.newHash}\0${createHash("sha1").update(JSON.stringify(src.functions)).update(src.covered).digest("hex")}`;
      if (!judgeCache.has(k)) { try { judgeCache.set(k, judge(p, a, b, src)); } catch { judgeCache.set(k, { changed: [] }); } }
      if (judgeCache.get(k).changed.some((c) => c.entered === true)) entered = true;
    }
    if (entered) B.add(id); else if (unknown) noRecord.add(id);
  }
  const secs = (set) => Math.round([...set].reduce((a, id) => a + (ms.get(id) ?? 0), 0) / 1000);
  out.push({
    wt: e.wt.slice(0, 8), from: e.from, to: e.to, editOnly: e.editOnly, changedPaths: changed.size, changedSample: [...changed.keys()].slice(0, 5),
    reached: reached.size, reachedS: secs(reached),
    cut: kept.size, cutS: secs(kept), B: B.size, BS: secs(B), noRecord: noRecord.size, noRecordS: secs(noRecord),
    failing: e.failing.map((id) => ({ test: checkOf.get(id).test_path, inCut: kept.has(id), inB: B.has(id), noRecord: noRecord.has(id), reached: reached.has(id) })),
  });
}
writeFileSync(outPath, JSON.stringify({ newFailures, inEditRevisions: events.length, edits: out }, null, 1));
console.error("done", out.length);
