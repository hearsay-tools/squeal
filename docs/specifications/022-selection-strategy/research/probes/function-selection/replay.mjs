// Throwaway probe for research/function-selection.md (Q1, Q5 inputs).
// Chain replay over a store copy: each test file's consecutive runs in one
// worktree whose key changed, with the paths changed in between (every
// revision stored). Rule A's conditions 1 to 5 are judged in order against
// the coverage record at the previous run's key; old and new contents come
// from git objects by blob id. Usage:
//   node replay.mjs <store.sqlite> <code.sqlite> <git-dir> <since-ms> <squeal.config.json> <out.json>
// A changed path that no part of the test file's known closure holds (stored
// import walk at the key, environment walk, flat closure, observed sets,
// declared inputs, listings) cannot re-key it and is left out, as in
// ../loaded-modules/replay.mjs.
import { writeFileSync, readFileSync } from "node:fs";
import { matchesGlob } from "node:path";
import { inflateRawSync, constants } from "node:zlib";
import { createHash } from "node:crypto";
import { open, coverageReader, blobReader } from "./lib.mjs";
import { judge, isScript } from "./structure.mjs";

const [storePath, codePath, gitDir, sinceArg, configPath, outPath] = process.argv.slice(2);
const config = JSON.parse(readFileSync(configPath, "utf8"));
const inputs = config.inputs ?? {};
const declaredRules = Array.isArray(inputs) ? [{ test: "**", globs: inputs }] : Object.entries(inputs).map(([test, globs]) => ({ test, globs: [globs].flat() }));
const declaredHit = (t, p) => declaredRules.some((r) => matchesGlob(t, r.test) && r.globs.some((g) => matchesGlob(p, g)));
const since = Number(sinceArg);
const s = open(storePath);
const cov = coverageReader(codePath);
const blobs = blobReader(gitDir);

// observed maps: observed (reads, stats, listings, loads), observedDirect and observedModules (child processes)
const observed = {};
for (const row of s.prepare("select key, value from meta where key like 'observed%.%'").all()) {
  const [kind, ...rest] = row.key.split(".");
  let map; try { map = JSON.parse(row.value); } catch { continue; }
  if (Array.isArray(map)) continue;
  (observed[kind] ??= {})[rest.join(".")] = map;
}
const obs = (kind, project, test) => observed[kind]?.[project]?.[test] ?? [];
const inflate = (b) => JSON.parse(inflateRawSync(b, { finishFlush: constants.Z_SYNC_FLUSH }).toString("utf8"));
const importsOf = s.prepare("select environment, imports from test_file_imports where project = ? and path = ? and key = ?");
const nearestImports = s.prepare("select environment, imports from test_file_imports where project = ? and path = ? order by recorded_at desc limit 1");
const envOf = s.prepare("select files, imports from environment_walks where project = ? and environment = ?");
const flatOf = s.prepare("select closure_paths from test_files where project = ? and path = ?");
const closureCache = new Map();
/** Every path the known closure of (project, test) at `key` holds; `null` with no stored walk or closure. */
function closureOf(project, test, key) {
  const id = `${project}\0${test}\0${key}`;
  if (closureCache.has(id)) return closureCache.get(id);
  const set = new Set([test]);
  const row = importsOf.get(project, test, key) ?? nearestImports.get(project, test);
  if (row) {
    for (const [p, st, dy] of inflate(row.imports)) { set.add(p); for (const t of st) set.add(t); for (const t of dy) set.add(t); }
    const env = envOf.get(project, row.environment);
    if (env) for (const f of JSON.parse(env.files)) set.add(f);
  }
  const flat = flatOf.get(project, test);
  if (flat) for (const p of JSON.parse(flat.closure_paths)) set.add(p);
  for (const k of ["observed", "observedDirect", "observedModules"]) for (const p of obs(k, project, test)) set.add(p);
  if (closureCache.size > 3000) closureCache.clear();
  closureCache.set(id, set);
  return set;
}
const ancestors = (p) => { const out = ["./"]; for (let i = p.indexOf("/"); i >= 0; i = p.indexOf("/", i + 1)) out.push(p.slice(0, i) + "/"); return out; };
const inClosure = (project, test, key, p, ch) => {
  const c = closureOf(project, test, key);
  return c.has(p) || declaredHit(test, p) || ((!ch.old || !ch.new) && ancestors(p).some((a) => c.has(a)));
};

const revs = new Map();
for (const r of s.prepare("select worktree_id, number, trigger, head, changes from revisions").all()) {
  if (!revs.has(r.worktree_id)) revs.set(r.worktree_id, new Map());
  let changes; try { changes = JSON.parse(r.changes); } catch { changes = null; }
  revs.get(r.worktree_id).set(r.number, { changes, trigger: r.trigger, head: r.head });
}

const fileRows = s.prepare(`
  select r.worktree_id wt, r.revision rev, r.run_id run, ch.project project, ch.test_path test,
         max(case when ch.kind='file' then r.key end) key,
         max(case when ch.kind='file' then r.outcome end) fileOutcome,
         max(case when ch.kind='file' then r.duration_ms end) fileMs,
         sum(case when ch.kind='test' then r.duration_ms else 0 end) testMs,
         sum(r.outcome='fail') fails, min(r.recorded_at) at, ru.checkpoint_id cp
  from results r join checks ch on ch.id = r.check_id join runs ru on ru.id = r.run_id
  where r.recorded_at >= ? and ru.worktree_id = r.worktree_id
  group by r.run_id, ch.project, ch.test_path`).all(since - 7 * 86400e3);

const byFile = new Map();
for (const r of fileRows) {
  const id = `${r.wt}\0${r.project}\0${r.test}`;
  if (!byFile.has(id)) byFile.set(id, []);
  byFile.get(id).push(r);
}
const counts = { files: byFile.size, firstRuns: 0, sameRevision: 0, gap: 0, sameKey: 0, noKey: 0, considered: 0 };
const pairs = [];
for (const runs of byFile.values()) {
  runs.sort((a, b) => a.at - b.at);
  for (let i = 1; i < runs.length; i++) {
    const cur = runs[i], prev = runs[i - 1];
    if (cur.at < since || cur.cp) continue;
    if (cur.rev === prev.rev) { counts.sameRevision++; continue; }
    if (!cur.key || !prev.key) { counts.noKey++; continue; }
    if (cur.key === prev.key) { counts.sameKey++; continue; }
    const w = revs.get(cur.wt);
    const changed = new Map();
    let complete = true, headMoved = false, triggers = new Set();
    let head0 = w?.get(prev.rev)?.head;
    for (let n = prev.rev + 1; n <= cur.rev; n++) {
      const rv = w?.get(n);
      if (!rv || !Array.isArray(rv.changes)) { complete = false; break; }
      triggers.add(rv.trigger);
      if (head0 !== undefined && rv.head !== head0) headMoved = true;
      for (const ch of rv.changes) {
        const was = changed.get(ch.path);
        changed.set(ch.path, { old: was ? was.old : ch.oldHash, new: ch.newHash });
      }
    }
    if (!complete) { counts.gap++; continue; }
    for (const [p, ch] of changed) if (ch.old === ch.new) changed.delete(p); // changed and changed back
    const outside = [];
    for (const [p, ch] of changed) if (!inClosure(cur.project, cur.test, prev.key, p, ch)) { outside.push(p); changed.delete(p); }
    if (changed.size === 0) { counts.keyMovedOutsideClosure = (counts.keyMovedOutsideClosure ?? 0) + 1; pairs.push({ prev, cur, changed, outsideOnly: true, single: cur.rev === prev.rev + 1, headMoved, watchOnly: [...triggers].every((t) => t === "watch") }); continue; }
    counts.considered++;
    pairs.push({ prev, cur, changed, single: cur.rev === prev.rev + 1, headMoved, watchOnly: [...triggers].every((t) => t === "watch") });
  }
}
console.error(counts);

// prefetch blobs of script paths for pairs with a record
const want = [];
const recCache = new Map();
const recordOf = (key) => { if (!recCache.has(key)) { recCache.set(key, cov.record(key)); if (recCache.size > 5000) recCache.delete(recCache.keys().next().value); } return recCache.get(key); };
for (const { prev, changed } of pairs) {
  if (!cov.has(prev.key)) continue;
  for (const [p, ch] of changed) if (isScript(p)) want.push(ch.old, ch.new);
}
blobs.prefetch(want);
console.error("blobs", new Set(want).size);

const judgeCache = new Map();
const structCache = new Map();
const out = [];
for (const { prev, cur, changed, single, headMoved, watchOnly, outsideOnly } of pairs) {
  const { project, test } = cur;
  if (outsideOnly) {
    out.push({ wt: cur.wt, project, test, prevRev: prev.rev, rev: cur.rev, prevKey: prev.key, key: cur.key, ms: cur.fileMs ?? cur.testMs ?? 0,
      failedNow: cur.fails > 0 || cur.fileOutcome === "fail", failedBefore: prev.fails > 0 || prev.fileOutcome === "fail", single, headMoved, watchOnly,
      nChanged: 0, stage: cov.has(prev.key) ? "c2:keyMovedOutsideKnownClosure" : "c1:noRecord", reasons: {}, ruleB: false, ruleBJudged: false, paths: [] });
    continue;
  }
  const rec = recordOf(prev.key);
  const paths = [];
  for (const [p, ch] of changed) {
    let v;
    if (!rec) v = "noRecord";
    else if (p === test) v = "testFile";
    else if (!rec.paths.has(p)) v = isScript(p) ? "scriptNotLoaded" : "nonScript";
    else if (rec.unread.has(p) || !rec.sources.has(p)) v = "unread";
    else if (rec.sources.get(p).blob !== ch.old) v = "blobMismatch";
    else if (!ch.new) v = "deleted";
    else {
      const a = blobs.get(ch.old), b = blobs.get(ch.new);
      if (a == null || b == null) v = a == null && b == null ? "noBlobs" : a == null ? "noOldBlob" : "noNewBlob";
      else {
        const src = rec.sources.get(p);
        const id = `${p}\0${ch.old}\0${ch.new}\0${createHash("sha1").update(JSON.stringify(src.functions)).update(src.covered).digest("hex")}`;
        if (!judgeCache.has(id)) {
          let r;
          try { r = judge(p, a, b, src, structCache); } catch (e) { r = { verdicts: ["judgeError"], changed: [], error: String(e).slice(0, 200) }; }
          judgeCache.set(id, r);
          if (structCache.size > 4000) structCache.clear();
        }
        const r = judgeCache.get(id);
        v = { verdicts: r.verdicts, changed: r.changed };
      }
    }
    paths.push([p, v]);
  }
  const has = (k) => paths.some(([, v]) => v === k || (typeof v === "object" && v.verdicts.includes(k)));
  const reasons = {};
  for (const [, v] of paths) for (const k of typeof v === "object" ? v.verdicts : [v]) reasons[k] = (reasons[k] ?? 0) + 1;
  // the funnel, conditions in the brief's order
  let stage;
  if (!rec) stage = "c1:noRecord";
  else if (has("unread") || has("blobMismatch")) stage = "c1:recordNotAtOldBytes";
  else if (has("testFile")) stage = "c2:testFileChanged";
  else if (has("nonScript")) stage = "c2:nonScriptPath";
  else if (has("scriptNotLoaded")) stage = "c2:scriptNotLoaded";
  else if (has("deleted")) stage = "c2:deleted";
  else if (has("entered")) stage = "c2:enteredBodyChanged";
  else if (has("noBlobs") || has("noOldBlob") || has("noNewBlob") || has("judgeError")) stage = "notJudged:" + (has("noOldBlob") || has("noBlobs") ? "noOldBlob" : has("noNewBlob") ? "noNewBlob" : "judgeError");
  else if (has("unmapped")) stage = "c2:unmappedBody";
  else if (has("skeleton")) stage = "c3:skeletonChanged";
  else if (has("parse")) stage = "c4:parse";
  else {
    // observedDirect: what a process the test file started loaded (spec 016 D4); observedModules is
    // every process's module-load evidence, the test file's own worker included, so no child signal
    const child = obs("observedDirect", project, test).length > 0;
    const reads = new Set(obs("observed", project, test));
    const readChanged = [...changed.keys()].some((p) => reads.has(p));
    stage = child ? "c5:childProcess" : readChanged ? "c5:readAsData" : "left";
  }
  // rule B: the record shows a changed function entered
  const ruleB = paths.some(([, v]) => typeof v === "object" && v.changed.some((c) => c.entered === true));
  const ruleBJudged = rec && paths.every(([, v]) => typeof v === "object" || ["testFile", "nonScript", "scriptNotLoaded"].includes(v));
  out.push({
    wt: cur.wt, project, test, prevRev: prev.rev, rev: cur.rev, prevKey: prev.key, key: cur.key,
    ms: cur.fileMs ?? cur.testMs ?? 0, failedNow: cur.fails > 0 || cur.fileOutcome === "fail",
    failedBefore: prev.fails > 0 || prev.fileOutcome === "fail", single, headMoved, watchOnly,
    nChanged: changed.size, stage, reasons, ruleB, ruleBJudged,
    paths: paths.slice(0, 12).map(([p, v]) => [p, typeof v === "object" ? { verdicts: v.verdicts, changed: v.changed.slice(0, 6) } : v]),
  });
}
writeFileSync(outPath, JSON.stringify({ counts, pairs: out }));
console.error("pairs", out.length);
