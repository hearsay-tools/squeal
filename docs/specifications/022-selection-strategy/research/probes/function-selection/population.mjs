// Throwaway probe for research/function-selection.md (Q1, Q5, Q6 share).
// Per edit revision: every stored `watch` revision without a HEAD move in the
// coverage window, and every test file whose known closure holds a path it
// changed (the newest stored closure, import walk, environment walk, observed
// sets, declared inputs, listings). For each such (revision, test file) pair:
// the test file's latest result in that worktree recorded before the
// revision is its key before the edit; the paths changed since that result
// (every revision between stored, restricted to the closure) are judged by
// rule A's conditions 1 to 5 in order against the coverage record at that
// key. Old and new contents: git objects by blob id. Seconds: the test file's
// median recorded file duration. Usage:
//   node population.mjs <store> <code> <git-dir> <since-ms> <config.json> <out.json>
import { writeFileSync, readFileSync } from "node:fs";
import { matchesGlob } from "node:path";
import { createHash } from "node:crypto";
import { inflateRawSync, constants } from "node:zlib";
import { open, coverageReader, blobReader, median } from "./lib.mjs";
import { judge, isScript } from "./structure.mjs";

const [storePath, codePath, gitDir, sinceArg, configPath, outPath] = process.argv.slice(2);
const since = Number(sinceArg);
const s = open(storePath);
const cov = coverageReader(codePath);
const blobs = blobReader(gitDir);
const config = JSON.parse(readFileSync(configPath, "utf8"));
const inputs = config.inputs ?? {};
const declaredRules = Array.isArray(inputs) ? [{ test: "**", globs: inputs }] : Object.entries(inputs).map(([test, globs]) => ({ test, globs: [globs].flat() }));
const inflate = (b) => JSON.parse(inflateRawSync(b, { finishFlush: constants.Z_SYNC_FLUSH }).toString("utf8"));
const t0 = Date.now();

// observed sets
const observed = {};
for (const row of s.prepare("select key, value from meta where key like 'observed%.%'").all()) {
  const [kind, ...rest] = row.key.split(".");
  let map; try { map = JSON.parse(row.value); } catch { continue; }
  if (Array.isArray(map)) continue;
  (observed[kind] ??= {})[rest.join(".")] = map;
}
const obs = (kind, project, test) => observed[kind]?.[project]?.[test] ?? [];

// file-level checks, their results and median durations
const checks = s.prepare("select id, project, test_path from checks where kind = 'file'").all();
const checkOf = new Map(checks.map((c) => [c.id, c]));
const resultsByWtCheck = new Map(); // `${wt}\0${check}` -> [{rev, at, key, outcome}]
const durations = new Map();
for (const r of s.prepare("select check_id, worktree_id wt, revision rev, recorded_at at, key, outcome, duration_ms ms from results where check_id in (select id from checks where kind='file') and recorded_at >= ?").iterate(since - 14 * 86400e3)) {
  const id = `${r.wt}\0${r.check_id}`;
  if (!resultsByWtCheck.has(id)) resultsByWtCheck.set(id, []);
  resultsByWtCheck.get(id).push(r);
  if (!durations.has(r.check_id)) durations.set(r.check_id, []);
  durations.get(r.check_id).push(r.ms);
}
for (const list of resultsByWtCheck.values()) list.sort((a, b) => a.at - b.at);
const medianMs = new Map([...durations].map(([k, v]) => [k, median(v)]));
// relaxed condition 1 (a weaker reading): the newest record of the test file, any worktree, made
// before the revision, whose bytes equal the edit's old contents on every changed path it holds
const recordedByCheck = new Map();
for (const list of resultsByWtCheck.values()) for (const r of list) if (cov.has(r.key)) { if (!recordedByCheck.has(r.check_id)) recordedByCheck.set(r.check_id, []); recordedByCheck.get(r.check_id).push(r); }
for (const list of recordedByCheck.values()) list.sort((a, b) => a.at - b.at);
console.error("results loaded", (Date.now() - t0) / 1000);

// closures: one per test file, the newest stored ones
const envOf = s.prepare("select files from environment_walks where project = ? and environment = ?");
const nearestImports = s.prepare("select environment, imports from test_file_imports where project = ? and path = ? order by recorded_at desc limit 1");
const reverse = new Map(); // path -> Set(check id)
const closures = new Map();
const add = (p, id) => { if (!reverse.has(p)) reverse.set(p, new Set()); reverse.get(p).add(id); };
for (const t of s.prepare("select project, path, closure_paths from test_files").all()) {
  const c = checks.find((x) => x.project === t.project && x.test_path === t.path);
  if (!c) continue;
  const set = new Set([t.path, ...JSON.parse(t.closure_paths)]);
  const row = nearestImports.get(t.project, t.path);
  if (row) {
    for (const [p, st, dy] of inflate(row.imports)) { set.add(p); for (const x of st) set.add(x); for (const x of dy) set.add(x); }
    const env = envOf.get(t.project, row.environment);
    if (env) for (const f of JSON.parse(env.files)) set.add(f);
  }
  for (const k of ["observed", "observedDirect", "observedModules"]) for (const p of obs(k, t.project, t.path)) set.add(p);
  closures.set(c.id, set);
  for (const p of set) add(p, c.id);
}
// each declared rule's test files, once; a path then checks the rules' globs only
for (const r of declaredRules) r.ids = new Set([...closures.keys()].filter((id) => matchesGlob(checkOf.get(id).test_path, r.test)));
const declaredMemo = new Map();
const declaredIds = (p) => {
  if (!declaredMemo.has(p)) { const ids = new Set(); for (const r of declaredRules) if (r.globs.some((g) => matchesGlob(p, g))) for (const id of r.ids) ids.add(id); declaredMemo.set(p, ids); }
  return declaredMemo.get(p);
};
const ancestors = (p) => { const out = ["./"]; for (let i = p.indexOf("/"); i >= 0; i = p.indexOf("/", i + 1)) out.push(p.slice(0, i) + "/"); return out; };
const holds = (id, p, ch) => { const c = closures.get(id); return !!c && (c.has(p) || declaredIds(p).has(id) || ((!ch.oldHash || !ch.newHash) && ancestors(p).some((a) => c.has(a)))); };
console.error("closures", closures.size, (Date.now() - t0) / 1000);

// revisions
const revs = new Map();
for (const r of s.prepare("select worktree_id wt, number, created_at at, trigger, head, changes from revisions order by worktree_id, number").all()) {
  if (!revs.has(r.wt)) revs.set(r.wt, new Map());
  let changes; try { changes = JSON.parse(r.changes); } catch { changes = null; }
  revs.get(r.wt).set(r.number, { ...r, changes });
}
const edits = [];
for (const [wt, m] of revs) for (const [n, r] of m) {
  if (r.at < since || r.trigger !== "watch" || !Array.isArray(r.changes)) continue;
  const prev = m.get(n - 1);
  if (!prev || prev.head !== r.head) continue; // HEAD moved: a checkout or commit, not an edit
  edits.push(r);
}
// POP_COMMITS=<commits.mjs output>: each commit is one edit, in a worktree of its own with no
// results, so condition 1 takes the relaxed reading only
if (process.env.POP_COMMITS) {
  edits.length = 0;
  JSON.parse(readFileSync(process.env.POP_COMMITS, "utf8")).forEach((c, i) => edits.push({ wt: `commit:${c.sha.slice(0, 10)}`, number: i + 1, at: c.at, trigger: "watch", head: c.sha, changes: c.changes }));
}
console.error("edit revisions", edits.length);

// pairs
const recCache = new Map();
const recordOf = (key) => { if (!recCache.has(key)) { recCache.set(key, cov.record(key)); if (recCache.size > 3000) recCache.delete(recCache.keys().next().value); } return recCache.get(key); };
const pairs = [];
const want = [];
for (const r of edits) {
  const ids = new Set();
  for (const ch of r.changes) {
    for (const id of reverse.get(ch.path) ?? []) ids.add(id);
    for (const id of declaredIds(ch.path)) ids.add(id);
    if (!ch.oldHash || !ch.newHash) for (const a of ancestors(ch.path)) for (const id of reverse.get(a) ?? []) ids.add(id); // listings
  }
  for (const id of ids) {
    if (!r.changes.some((ch) => holds(id, ch.path, ch))) continue;
    const list = resultsByWtCheck.get(`${r.wt}\0${id}`) ?? [];
    let before = null;
    for (const x of list) { if (x.at < r.at && x.rev < r.number) before = x; else break; }
    const pair = { wt: r.wt, rev: r.number, id, ms: medianMs.get(id) ?? 0, nChanged: r.changes.length };
    const relax = () => {
      const own = new Map(r.changes.filter((ch) => ch.oldHash !== ch.newHash && holds(id, ch.path, ch)).map((ch) => [ch.path, ch]));
      if (own.size === 0) return null;
      const cands = (recordedByCheck.get(id) ?? []).filter((x) => x.at < r.at).slice(-30).reverse();
      for (const x of cands) {
        const rec = recordOf(x.key);
        if (!rec) continue;
        if ([...own].every(([p, ch]) => !rec.sources.has(p) || rec.sources.get(p).blob === ch.oldHash)) {
          for (const [p, ch] of own) if (isScript(p)) want.push(ch.oldHash, ch.newHash);
          return { key: x.key, changed: new Map([...own].map(([p, ch]) => [p, { oldHash: ch.oldHash, newHash: ch.newHash }])) };
        }
      }
      return "none";
    };
    if (!before) { pair.stage = "c1:noRunInWorktree"; pair.relaxed = relax(); pairs.push(pair); continue; }
    // paths changed since that result, in the closure
    const changed = new Map();
    let gap = false;
    for (let n = before.rev + 1; n <= r.number; n++) {
      const x = revs.get(r.wt).get(n);
      if (!x || !Array.isArray(x.changes)) { gap = true; break; }
      for (const ch of x.changes) { const was = changed.get(ch.path); changed.set(ch.path, { oldHash: was ? was.oldHash : ch.oldHash, newHash: ch.newHash }); }
    }
    if (gap) { pair.stage = "notJudged:revisionGap"; pairs.push(pair); continue; }
    for (const [p, ch] of changed) if (ch.oldHash === ch.newHash || !holds(id, p, ch)) changed.delete(p);
    pair.span = r.number - before.rev;
    // nothing in the closure differs from the record's bytes (an edit and its revert): the key is the
    // record's again and today's rule reuses its result; not part of the funnel
    if (changed.size === 0) { pair.stage = "x:sameAsRecord"; pairs.push(pair); continue; }
    pair.key = before.key;
    pair.changed = changed;
    if (!cov.has(before.key)) { pair.stage = "c1:noRecordAtKey"; pair.relaxed = relax(); pairs.push(pair); continue; }
    for (const [p, ch] of changed) if (isScript(p)) want.push(ch.oldHash, ch.newHash);
    pairs.push(pair);
  }
}
console.error("pairs", pairs.length, (Date.now() - t0) / 1000);
blobs.prefetch(want.filter(Boolean));
console.error("blobs", new Set(want).size, (Date.now() - t0) / 1000);

const judgeCache = new Map();
const structCache = new Map();
const timing = { judged: 0, ms: 0 };
function judgePair(pair) {
  const { test_path: test, project } = checkOf.get(pair.id);
  const rec = recordOf(pair.key);
  const verdicts = [];
  const fns = [];
  for (const [p, ch] of pair.changed) {
    let v;
    if (p === test) v = "testFile";
    else if (!rec.paths.has(p)) v = isScript(p) ? "scriptNotLoaded" : "nonScript";
    else if (rec.unread.has(p) || !rec.sources.has(p)) v = "unread";
    else if (rec.sources.get(p).blob !== ch.oldHash) v = "blobMismatch";
    else if (!ch.newHash) v = "deleted";
    else {
      const a = blobs.get(ch.oldHash), b = blobs.get(ch.newHash);
      if (a == null || b == null) v = a == null ? "noOldBlob" : "noNewBlob";
      else {
        const src = rec.sources.get(p);
        const id = `${p}\0${ch.oldHash}\0${ch.newHash}\0${createHash("sha1").update(JSON.stringify(src.functions)).update(src.covered).digest("hex")}`;
        if (!judgeCache.has(id)) {
          const t = performance.now();
          let j; try { j = judge(p, a, b, src, structCache); } catch (e) { j = { verdicts: ["judgeError"], changed: [] }; }
          timing.judged++; timing.ms += performance.now() - t;
          if (structCache.size > 4000) structCache.clear();
          judgeCache.set(id, j);
        }
        const j = judgeCache.get(id);
        v = j.verdicts.length ? j.verdicts.join("+") : "bodiesOnly";
        fns.push(...j.changed.map((c) => ({ path: p, ...c })));
      }
    }
    verdicts.push([p, v]);
  }
  const has = (k) => verdicts.some(([, v]) => v.split("+").includes(k));
  let stage;
  if (has("unread") || has("blobMismatch")) stage = "c1:recordNotAtOldBytes";
  else if (has("testFile")) stage = "c2:testFileChanged";
  else if (has("nonScript")) stage = "c2:nonScriptPath";
  else if (has("scriptNotLoaded")) stage = "c2:scriptNotLoaded";
  else if (has("deleted")) stage = "c2:deleted";
  else if (has("entered")) stage = "c2:enteredBodyChanged";
  else if (has("noOldBlob") || has("noNewBlob") || has("judgeError")) stage = "notJudged:" + (has("noOldBlob") ? "noOldBlob" : has("noNewBlob") ? "noNewBlob" : "judgeError");
  else if (has("unmapped")) stage = "c2:unmappedBody";
  else if (has("skeleton")) stage = "c3:skeletonChanged";
  else if (has("parse")) stage = "c4:parse";
  else {
    // observedDirect: what a process the test file started loaded (spec 016 D4); observedModules is
    // every process's module-load evidence, the test file's own worker included, so no child signal
    const child = obs("observedDirect", project, test).length > 0;
    const reads = new Set(obs("observed", project, test));
    stage = child ? "c5:childProcess" : [...pair.changed.keys()].some((p) => reads.has(p)) ? "c5:readAsData" : "left";
  }
  return { stage, verdicts, ruleB: fns.some((f) => f.entered === true), fns: fns.slice(0, 8) };
}
for (const pair of pairs) {
  if (!pair.stage) Object.assign(pair, judgePair(pair));
  else if (pair.relaxed && pair.relaxed !== "none") {
    const j = judgePair({ id: pair.id, key: pair.relaxed.key, changed: pair.relaxed.changed });
    pair.relaxed = { stage: j.stage, verdicts: j.verdicts, ruleB: j.ruleB };
  } else if (pair.relaxed === "none") pair.relaxed = { stage: "c1:noCompatibleRecord" };
  else if (pair.relaxed === null) pair.relaxed = { stage: "x:noOwnChange" };
}
const outPairs = pairs.map(({ changed, ...p }) => ({ ...p, test: checkOf.get(p.id).test_path, project: checkOf.get(p.id).project, changed: changed ? [...changed.keys()].slice(0, 10) : undefined }));
writeFileSync(outPath, JSON.stringify({ edits: edits.length, timing, pairs: outPairs }));
console.error("done", (Date.now() - t0) / 1000, timing);
