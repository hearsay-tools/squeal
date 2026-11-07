// Throwaway probe for research/edit-relevance.md (2026-11-07). Read only: store copies, report.json
// copies, a clone at a named commit. No test runs.
//
// Replays every agent edit (a `watch` revision of 1 to 3 paths that changes a source some test file's
// closure holds) since the first coverage record, under five run orders, and asks where each new
// failure the store recorded after it would have come:
//   T  today: the edit cut (011 C4 step 4, src/core/scheduler/edit-cut.ts `editWork`) as the edit's
//      work, then catch-up shortest first (src/core/scheduler/queue.ts `sorted`)
//   A  Change 1 as stated: the edit's work is every re-keyed file whose newest coverage record (at or
//      before the revision) shows a function of a changed source ran; no record falls back to T's cut
//   B  T's cut, then catch-up ordered called, no record, loaded only, not loaded; shortest first in each
//   C  a capped A: edited test files, called namesakes, the K shortest other called files (T's cut
//      when none is called), then catch-up as B
//   P  the proxy without coverage: T's cut, then catch-up ordered by import kind (direct value import,
//      value path with no barrel and no test helper, other value path, no value path)
// Work ahead of a file: the recorded seconds of the files ordered before it, plus its own. Edit work
// runs at once; catch-up waits for the 20 s quiet (src/core/scheduler/quiet.ts).
// With "anyRecord": true in the spec, revisions before the first record count too, and a file with no
// record at the revision takes its first later record (code may have moved since).
// Usage: node order.mjs <spec.json> <out.json>
import { DatabaseSync } from "node:sqlite";
import { inflateRawSync, constants } from "node:zlib";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, posix } from "node:path";
import { loadGraph } from "./graph.mjs";

const spec = JSON.parse(readFileSync(process.argv[2], "utf8"));
const K = spec.K ?? 4;
const g = await loadGraph(spec);
const manual = spec.manual ? new RegExp(spec.manual) : null;
const helperRe = new RegExp(spec.helper);
const db = new DatabaseSync(spec.store, { readOnly: true });
const code = new DatabaseSync(spec.code, { readOnly: true });

// ---- test files (project + path), their reach (stored closure + project setup closure)
const tests = new Map();
for (const r of db.prepare("select project, path, closure_paths from test_files").all()) {
  if (!g.trackedSet.has(r.path) || manual?.test(r.path)) continue;
  tests.set(r.project + "\0" + r.path, { id: r.project + "\0" + r.path, project: r.project, path: r.path, closure: new Set(JSON.parse(r.closure_paths).filter((p) => !p.endsWith("/"))) });
}
const testPaths = new Set([...tests.values()].map((t) => t.path));
const setup = new Map();
for (const [project, files] of Object.entries(spec.setup ?? {})) {
  const s = new Set(); for (const f of files) for (const x of g.depths(f).keys()) s.add(x); setup.set(project, s);
}
const holders = new Map(); // path -> Set of test ids whose reach holds it
for (const t of tests.values()) {
  t.reach = new Set([...t.closure, ...(setup.get(t.project) ?? setup.get("") ?? [])]);
  for (const p of t.reach) (holders.get(p) ?? holders.set(p, new Set()).get(p)).add(t.id);
}

// ---- recorded seconds: median fileDurations over the run reports, else the newest results' sum
const durs = new Map();
for (const d of readdirSync(spec.runs)) {
  const f = join(spec.runs, d, "report.json"); if (!existsSync(f)) continue;
  let r; try { r = JSON.parse(readFileSync(f, "utf8")).report; } catch { continue; }
  for (const fd of r?.fileDurations ?? []) if (fd.durationMs > 0) {
    const k = fd.testFile.project + "\0" + fd.testFile.path; (durs.get(k) ?? durs.set(k, []).get(k)).push(fd.durationMs / 1000);
  }
}
const median = (a) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
for (const t of tests.values()) t.sec = durs.has(t.id) ? median(durs.get(t.id)) : null;

// ---- declared inputs (squeal.config.json `inputs`)
const inputs = JSON.parse(readFileSync(spec.config, "utf8")).inputs ?? {};
const rules = Array.isArray(inputs) ? [{ test: "**", globs: inputs }] : Object.entries(inputs).map(([test, globs]) => ({ test, globs: [].concat(globs) }));
const declared = (t, p) => rules.some((r) => posix.matchesGlob(t.path, r.test) && r.globs.some((gl) => posix.matchesGlob(p, gl)));

// ---- static import kinds per test file, lazily
const isHelper = (p) => helperRe.test(p) && !testPaths.has(p);
const statics = new Map();
function staticOf(t) {
  if (!statics.has(t.path)) statics.set(t.path, { value: g.depths(t.path), plain: g.depths(t.path, (m) => !g.parse(m).barrel && !isHelper(m)) });
  return statics.get(t.path);
}

// ---- coverage: per test path, its records by time; decode lazily
const keyTest = new Map();
for (const r of db.prepare("select distinct r.key k, c.test_path t from results r join checks c on c.id = r.check_id where c.kind = 'file'").all()) keyTest.set(r.k, r.t);
const recs = new Map();
let covStart = Infinity;
for (const r of code.prepare("select result_key k, recorded_at a from coverage where provider_version = 3").all()) {
  const t = keyTest.get(r.k); if (!t) continue;
  (recs.get(t) ?? recs.set(t, []).get(t)).push(r); covStart = Math.min(covStart, r.a);
}
for (const a of recs.values()) a.sort((x, y) => x.a - y.a);
const getRec = code.prepare("select record from coverage where result_key = ? and provider_version = 3");
const getPart = code.prepare("select part from coverage_parts where id = ?");
const ran = (src) => (src.functions ?? []).some((f) => f[4] === 1 && !(f[0] === 1 && f[1] === 0));
const partCache = new Map();
const part = (id) => { if (partCache.has(id)) return partCache.get(id);
  let v = null; try { const b = getPart.get(id)?.part; if (b) { const src = JSON.parse(inflateRawSync(b, { finishFlush: constants.Z_SYNC_FLUSH }).toString("utf8")); v = { path: src.path, called: ran(src) }; } } catch {}
  partCache.set(id, v); return v; };
const decoded = new Map();
function coverageAt(path, at) {
  const a = recs.get(path); if (!a) return null;
  let lo = 0, hi = a.length - 1, best = -1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (a[mid].a <= at) { best = mid; lo = mid + 1; } else hi = mid - 1; }
  if (best < 0) { if (!spec.anyRecord) return null; best = 0; } // anyRecord: the first later record stands in
  const k = a[best].k;
  if (!decoded.has(k)) {
    let m = null;
    try { const rec = JSON.parse(inflateRawSync(getRec.get(k).record).toString("utf8")); m = new Map();
      for (const p of rec.unread ?? []) m.set(p, null);
      for (const src of rec.sources ?? []) m.set(src.path, ran(src));
      if (Array.isArray(rec.parts)) { let at2 = 0, id = 0;
        for (let i = 0; i < rec.parts.length; i += 2) { at2 += rec.parts[i]; id += rec.parts[i + 1]; const pt = part(id); const p = rec.unread[at2]; if (pt && pt.path === p) m.set(p, pt.called); } }
    } catch { m = null; }
    decoded.set(k, m);
  }
  return decoded.get(k);
}

// ---- namesakes (src/core/scheduler/namesakes.ts, copied)
const SCRIPT = /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/, MARKED = /^(.+)\.(?:test|spec)\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
const testedName = (p) => { const b = posix.basename(p); const m = MARKED.exec(b); if (m) return m[1];
  return posix.basename(posix.dirname(p)) === "__tests__" && SCRIPT.test(b) ? b.replace(SCRIPT, "") : null; };
const allTestPaths = [...testPaths];
function namesakesOf(source) {
  if (!SCRIPT.test(source)) return [];
  const name = posix.basename(source).replace(/\.[^.]+$/, ""); if (name === "index") return [];
  const named = allTestPaths.filter((p) => p !== source && testedName(p) === name);
  const dir = posix.dirname(source); const dirs = new Set([dir, posix.join(dir, "__tests__")]);
  const seg = source.split("/"); const at = seg.indexOf("src");
  if (at >= 0 && at < seg.length - 1) for (const tree of ["test", "tests"]) dirs.add(posix.join(...seg.slice(0, at), tree, ...seg.slice(at + 1, -1)));
  const near = named.filter((p) => dirs.has(posix.dirname(p)));
  return near.length ? near : named.length === 1 ? named : [];
}

// ---- revisions and the store's new failures
const revs = db.prepare("select worktree_id w, number n, created_at a, trigger, changes from revisions order by worktree_id, number").all()
  .map((r) => ({ ...r, paths: JSON.parse(r.changes).map((c) => c.path) }));
const byWt = new Map(); for (const r of revs) (byWt.get(r.w) ?? byWt.set(r.w, []).get(r.w)).push(r);
const fails = new Map(); // w -> [{test path, project, at, revision}]
for (const r of db.prepare(`select t.worktree_id w, t.at, t.revision, c.project, c.test_path from transitions t join checks c on c.id = t.check_id
  where t.to_outcome = 'fail' and (t.from_outcome is null or t.from_outcome <> 'fail')`).all())
  (fails.get(r.w) ?? fails.set(r.w, []).get(r.w)).push(r);

const secOf = (id) => tests.get(id)?.sec;
const byShort = (a, b) => (secOf(a) ?? Infinity) - (secOf(b) ?? Infinity) || (a < b ? -1 : a > b ? 1 : 0);
const sum = (ids) => ids.reduce((s, id) => s + (secOf(id) ?? 0), 0);

const out = { spec: { repo: spec.repo, K, covStart }, revisions: [], failures: [], pairs: [] };
for (const [w, list] of byWt) {
  for (let i = 0; i < list.length; i++) {
    const rev = list[i];
    if (rev.trigger !== "watch" || rev.paths.length < 1 || rev.paths.length > 3 || (!spec.anyRecord && rev.a < covStart)) continue;
    const changedTests = new Set(), sources = [];
    for (const p of rev.paths) {
      for (const t of tests.values()) if (t.path === p) changedTests.add(t.id);
      if (!testPaths.has(p) && holders.has(p)) sources.push(p);
    }
    if (sources.length === 0) continue;
    const R = new Set(changedTests);
    for (const s of sources) for (const id of holders.get(s)) R.add(id);
    // classify each re-keyed file
    const info = new Map();
    for (const id of R) {
      const t = tests.get(id); const st = staticOf(t);
      const cov = coverageAt(t.path, rev.a);
      let cls = changedTests.has(id) ? "own" : cov === null ? "noRecord" : "notLoaded";
      let depth = Infinity, plain = Infinity, declOnly = true, nameSake = false;
      for (const s of sources) {
        if (!t.reach.has(s)) continue;
        depth = Math.min(depth, st.value.get(s) ?? Infinity); plain = Math.min(plain, st.plain.get(s) ?? Infinity);
        if (!(declared(t, s) && !st.value.has(s))) declOnly = false;
        if (cov && cls !== "own") { if (cov.has(s)) { const c = cov.get(s); if (c === true) cls = "called"; else if (c === null && cls !== "called") cls = "loadedUnknown"; else if (cls === "notLoaded") cls = "loadedOnly"; } }
      }
      info.set(id, { cls, depth, plain, declOnly });
    }
    for (const s of sources) for (const p of namesakesOf(s)) for (const id of R) if (tests.get(id).path === p) info.get(id).nameSake = true;
    const runFirst = (id) => ["own", "called", "loadedUnknown"].includes(info.get(id).cls);
    // T: the edit cut
    const kept = new Set(changedTests);
    for (const s of sources) {
      const own = [...R].filter((id) => info.get(id).nameSake && namesakesOf(s).includes(tests.get(id).path));
      const direct = [...R].filter((id) => tests.get(id).reach.has(s) && staticOf(tests.get(id)).value.get(s) === 1);
      for (const id of own.length ? own : direct) kept.add(id);
    }
    const importers = [...R].filter((id) => info.get(id).depth === 1 && !kept.has(id)).sort(byShort);
    const reads = [...R].filter((id) => info.get(id).depth !== 1 && !kept.has(id) && !info.get(id).declOnly).sort(byShort);
    for (const id of [...importers, ...reads].slice(0, K)) kept.add(id);
    const editOrder = (ids) => [...ids].sort((a, b) => Number(!changedTests.has(a)) - Number(!changedTests.has(b)) || Number(info.get(a).depth !== 1) - Number(info.get(b).depth !== 1) || byShort(a, b));
    const covRank = (id) => ({ own: 0, called: 0, loadedUnknown: 0, noRecord: 1, loadedOnly: 2, notLoaded: 3 })[info.get(id).cls];
    const kindRank = (id) => { const x = info.get(id); return x.depth === 1 ? 0 : x.plain < Infinity ? 1 : x.depth < Infinity ? 2 : 3; };
    const rest = (edit) => [...R].filter((id) => !edit.has(id));
    const orders = {};
    orders.T = { edit: editOrder(kept), catchUp: rest(kept).sort(byShort) };
    const aEdit = new Set([...R].filter((id) => runFirst(id) || (info.get(id).cls === "noRecord" && kept.has(id))));
    orders.A = { edit: editOrder(aEdit), catchUp: rest(aEdit).sort(byShort) };
    orders.B = { edit: orders.T.edit, catchUp: rest(kept).sort((a, b) => covRank(a) - covRank(b) || byShort(a, b)) };
    const called = [...R].filter((id) => !changedTests.has(id) && runFirst(id));
    let cEdit;
    if (called.length === 0) cEdit = kept;
    else { cEdit = new Set(changedTests); for (const id of called) if (info.get(id).nameSake) cEdit.add(id);
      for (const id of called.filter((id) => !cEdit.has(id)).sort(byShort).slice(0, K)) cEdit.add(id); }
    orders.C = { edit: editOrder(cEdit), catchUp: rest(cEdit).sort((a, b) => covRank(a) - covRank(b) || byShort(a, b)) };
    orders.P = { edit: orders.T.edit, catchUp: rest(kept).sort((a, b) => kindRank(a) - kindRank(b) || byShort(a, b)) };
    // window: until the next revision of this worktree that changes a path the file's reach holds
    const next = list.slice(i + 1);
    const failsHere = [];
    for (const f of fails.get(w) ?? []) {
      const id = f.project + "\0" + f.test_path;
      if (!R.has(id) || f.at < rev.a || f.revision < rev.n) continue;
      const t = tests.get(id);
      const end = next.find((x) => x.paths.some((p) => p === t.path || t.reach.has(p)));
      if (end && f.at >= end.a) continue;
      if (f.at - rev.a > 2 * 3600e3) continue;
      if (!failsHere.some((x) => x.id === id)) failsHere.push({ id, at: f.at - rev.a });
    }
    const pos = {};
    for (const [name, o] of Object.entries(orders)) {
      const seq = [...o.edit, ...o.catchUp]; let acc = 0; const m = new Map();
      for (const id of seq) { acc += secOf(id) ?? 0; m.set(id, { ahead: acc, edit: o.edit.includes(id), rank: m.size }); }
      pos[name] = m;
    }
    for (const f of failsHere) out.failures.push({ w, n: rev.n, id: f.id, cls: info.get(f.id).cls, depth: info.get(f.id).depth, plain: info.get(f.id).plain, observedAfterMs: f.at,
      sec: secOf(f.id), ...Object.fromEntries(Object.keys(orders).map((k) => [k, pos[k].get(f.id)])) });
    const clsSec = {}; for (const id of R) { const c = info.get(id).cls; clsSec[c] = (clsSec[c] ?? 0) + (secOf(id) ?? 0); }
    out.revisions.push({ w, n: rev.n, sources, files: R.size, sec: sum([...R]), clsSec,
      edit: Object.fromEntries(Object.entries(orders).map(([k, o]) => [k, { files: o.edit.length, sec: sum(o.edit) }])),
      tKeptNotCalled: sum([...kept].filter((id) => !runFirst(id) && !changedTests.has(id))), tKeptNotCalledFiles: [...kept].filter((id) => !runFirst(id) && !changedTests.has(id)).length,
      fails: failsHere.length });
    // pairs for the proxy's quality: one per re-keyed file that is not an edited test file
    for (const id of R) { if (changedTests.has(id)) continue; const x = info.get(id);
      out.pairs.push([x.cls, x.depth === Infinity ? -1 : x.depth, x.plain === Infinity ? -1 : x.plain, x.nameSake ? 1 : 0, x.declOnly ? 1 : 0, +(secOf(id) ?? 0).toFixed(2)]); }
  }
}
writeFileSync(process.argv[3], JSON.stringify(out));
console.log(JSON.stringify({ revisions: out.revisions.length, failures: out.failures.length, pairs: out.pairs.length, covStart: new Date(covStart).toISOString(), decoded: decoded.size }));
