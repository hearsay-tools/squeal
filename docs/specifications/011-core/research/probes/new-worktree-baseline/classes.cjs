// 011-299 probe (throwaway): why each first-baseline file run found no stored result at its key.
// Usage: node classes.cjs <store copy> <firsts.jsonl> <git dir of the repository> [maxY] > classes.jsonl
// The store keeps one row per (check, key) and a later run at the same key replaces it, so an equal key stored
// earlier is seen only as an "orphan": an earlier run that completed the file and has no row for it now.
// Content is compared with git trees: the test file's closure (test_files.closure_paths, the shared observed set,
// policy and runner files) between the run's commit and the commits of rows other runs stored before it.
// Per file run, flags; the first matching class is chosen in summary.cjs.
const { DatabaseSync } = require("node:sqlite");
const { execFileSync } = require("child_process");
const fs = require("fs");
const [, , storePath, firstsPath, gitDir, maxYArg] = process.argv;
const MAXY = Number(maxYArg ?? 12);
const db = new DatabaseSync(storePath, { readOnly: true });
const git = (...a) => execFileSync("git", ["-C", gitDir, ...a], { encoding: "utf8", maxBuffer: 1 << 28 });
const L = fs.readFileSync(firstsPath, "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((x) => !x.summary);

// closures: static plus declared (test_files) and observed (meta observed.<project>), current state
const closure = new Map();
for (const r of db.prepare("select project, path, closure_paths from test_files").all()) closure.set(r.project + "\0" + r.path, new Set(JSON.parse(r.closure_paths)));
for (const m of db.prepare("select key, value from meta where key like 'observed.%'").all()) {
  const project = m.key.slice("observed.".length);
  for (const [t, ps] of Object.entries(JSON.parse(m.value))) { const k = project + "\0" + t; const s = closure.get(k) ?? closure.set(k, new Set()).get(k); for (const p of ps) s.add(p); }
}
const ENV = /(^|\/)(vitest\.[^/]*|pnpm-lock\.yaml|pnpm-workspace\.yaml|\.npmrc|squeal\.config\.json|playwright\.config\.[^/]*)$/;
const touchedPaths = (file, changes) => {
  if (changes === null) return null;
  const cl = closure.get(file) ?? new Set([file.split("\0")[1]]);
  return [...changes].filter(([p, st]) => cl.has(p) || ENV.test(p) || (st !== "M" && (cl.has("./") || [...p.matchAll(/\//g)].some((m) => cl.has(p.slice(0, m.index) + "/"))))).map(([p]) => p);
};
const touches = (file, changes) => {
  if (changes === null) return true; // unknown commit: assume touched
  const cl = closure.get(file) ?? new Set([file.split("\0")[1]]);
  for (const [p, st] of changes) {
    if (cl.has(p) || ENV.test(p)) return true;
    if (st !== "M") { // an add or delete changes every ancestor listing
      for (let at = p.indexOf("/"); at >= 0; at = p.indexOf("/", at + 1)) if (cl.has(p.slice(0, at) + "/")) return true;
      if (cl.has("./")) return true;
    }
  }
  return false;
};
// one `git ls-tree -r` per commit (path -> blob); a pair's changes are the paths whose blob differs
const trees = new Map();
const treeOf = (c) => {
  if (!c) return null;
  if (!trees.has(c)) {
    let m = null;
    try { m = new Map(); for (const line of git("ls-tree", "-r", "--full-tree", c).split("\n")) { if (!line) continue; const t = line.indexOf("\t"); m.set(line.slice(t + 1), line.slice(0, t).split(" ")[2]); } } catch { m = null; }
    trees.set(c, m);
  }
  return trees.get(c);
};
const diffs = new Map();
const changed = (a, b) => {
  if (a === b) return new Map();
  const k = a < b ? a + b : b + a;
  if (diffs.has(k)) return diffs.get(k);
  const ta = treeOf(a), tb = treeOf(b);
  let v = null;
  if (ta && tb) {
    v = new Map();
    for (const [p, h] of ta) { const o = tb.get(p); if (o === undefined) v.set(p, "D"); else if (o !== h) v.set(p, "M"); }
    for (const p of tb.keys()) if (!ta.has(p)) v.set(p, "A");
  }
  diffs.set(k, v); return v;
};

// start commit per checkpoint: rows at the checkpoint revision, else the live worktree's revision head, else the first row
const start = new Map();
for (const x of L) if (x.commit && x.rev === x.ckRev && !start.has(x.ck)) start.set(x.ck, { sha: x.commit, dirty: x.dirty, how: "row at start revision" });
const revHead = db.prepare("select head, dirty from revisions where worktree_id = ? and number = ?");
for (const x of L) if (!start.has(x.ck)) { const r = revHead.get(x.W, x.ckRev); if (r?.head) start.set(x.ck, { sha: r.head, dirty: r.dirty, how: "revision head" }); }
const byCk = new Map(); for (const x of L) (byCk.get(x.ck) ?? byCk.set(x.ck, []).get(x.ck)).push(x);
for (const [ck, xs] of byCk) if (!start.has(ck)) { const y = xs.filter((x) => x.commit).sort((a, b) => a.rs - b.rs)[0]; if (y) start.set(ck, { sha: y.commit, dirty: y.dirty, how: "first row" }); }

// the live worktree's own changes between two revisions
const revChanges = db.prepare("select changes from revisions where worktree_id = ? and number > ? and number <= ?");
const ownPaths = (W, a, b) => { const out = new Map(); let n = 0; for (const r of revChanges.all(W, a, b)) { n++; for (const c of JSON.parse(r.changes)) out.set(c.path, c.oldHash === null || c.newHash === null ? "A" : "M"); } return n ? out : null; };

const checksOf = new Map();
for (const c of db.prepare("select id, project, test_path from checks").all()) { const k = c.project + "\0" + c.test_path; (checksOf.get(k) ?? checksOf.set(k, []).get(k)).push(c.id); }
const rowsBefore = db.prepare("select key, commit_sha, dirty, worktree_id, run_id, recorded_at from results where check_id = ? and recorded_at < ? order by recorded_at desc");
// every run, by file, for orphans and overlaps
const runs = db.prepare("select id, worktree_id, test_files, log_dir, started_at, ended_at from runs").all();
const runsOfFile = new Map();
for (const r of runs) for (const f of JSON.parse(r.test_files)) { const k = f.project + "\0" + f.path; (runsOfFile.get(k) ?? runsOfFile.set(k, []).get(k)).push(r); }
const repCache = new Map();
const completed = (r, k) => {
  let s = repCache.get(r.id);
  if (s === undefined) {
    try { const rep = JSON.parse(fs.readFileSync(r.log_dir + "/report.json", "utf8")).report; s = new Set([...(rep.completedFiles ?? []), ...(rep.fileDurations ?? []).map((d) => d.testFile)].map((f) => f.project + "\0" + f.path)); } catch { s = null; }
    repCache.set(r.id, s);
  }
  return s === null ? null : s.has(k);
};
const runRows = db.prepare("select c.project, c.test_path, r.commit_sha, r.dirty from results r join checks c on c.id = r.check_id where r.run_id = ?");
const rowCache = new Map();
const rowsOf = (id) => { let v = rowCache.get(id); if (!v) { v = { files: new Set(), commit: null, dirty: null }; for (const x of runRows.all(id)) { v.files.add(x.project + "\0" + x.test_path); v.commit ??= x.commit_sha; v.dirty ??= x.dirty; } rowCache.set(id, v); } return v; };

for (const x of L) {
  if (!x.ended) { console.log(JSON.stringify({ ...x, cls: "not ended" })); continue; }
  const s = start.get(x.ck);
  const out = { ck: x.ck, W: x.W, live: x.live, T: x.T, run: x.run, rs: x.rs, re: x.re, file: x.file, sec: x.sec, stored: x.keys.length > 0, fail: x.fail,
    X0: s?.sha ?? null, X0dirty: s?.dirty ?? null, X0how: s?.how ?? null, X: x.commit ?? x.runCommit, Xdirty: x.dirty ?? x.runDirty };
  // own changes since the start: committed (git) and uncommitted (live revisions only)
  const X = out.X, X0 = out.X0;
  out.ownCommitted = X && X0 && X !== X0 ? touches(x.file, changed(X0, X)) : false;
  out.ownDirty = null;
  if (out.Xdirty || out.X0dirty) {
    const own = x.live ? ownPaths(x.W, x.ckRev, x.rev ?? x.ckRev) : null;
    out.ownDirty = !x.live ? "unknown" : own === null ? "none" : touches(x.file, own) ? "touched" : "untouched";
  }
  // orphans and overlaps: other runs of the file that completed it and kept no row for it
  const content = X ?? X0;
  const same = (c, d) => c && content && !d && !out.Xdirty && !touches(x.file, changed(content, c));
  out.orphanBefore = []; out.overlap = [];
  for (const r of runsOfFile.get(x.file) ?? []) {
    if (r.id === x.run) continue;
    const ov = r.started_at < (x.re ?? x.rs) && (r.ended_at ?? r.started_at) > x.rs;
    const before = r.ended_at !== null && r.ended_at <= x.rs && r.ended_at > x.rs - 7 * 864e5;
    if (!ov && !before) continue;
    if (completed(r, x.file) !== true) continue;
    const rr = rowsOf(r.id);
    const orphan = !rr.files.has(x.file);
    const e = { run: r.id, W: r.worktree_id, orphan, sameContent: same(rr.commit, rr.dirty), commit: rr.commit };
    if (ov && r.worktree_id !== x.W) out.overlap.push(e);
    else if (before && orphan) out.orphanBefore.push(e);
  }
  // content: rows other runs stored before this run started, clean, at most MAXY distinct commits
  const ys = new Map();
  for (const cid of checksOf.get(x.file) ?? []) for (const r of rowsBefore.all(cid, x.rs)) {
    if (r.dirty || !r.commit_sha || r.run_id === x.run) continue;
    const y = ys.get(r.commit_sha) ?? { at: 0, keys: new Set(), wts: new Set() };
    y.at = Math.max(y.at, r.recorded_at); y.keys.add(r.key); y.wts.add(r.worktree_id); ys.set(r.commit_sha, y);
  }
  const yl = [...ys].sort((a, b) => b[1].at - a[1].at).slice(0, MAXY);
  out.nY = ys.size;
  const target = out.ownCommitted ? X : X0;
  const eq = yl.filter(([c]) => target && !touches(x.file, changed(target, c)));
  out.sameContentY = eq.map(([c, y]) => ({ c, at: y.at, nKeys: y.keys.size, wts: [...y.wts] }));
  out.sameTreeY = eq.some(([c]) => c === target);
  if (eq.length === 0 && target && yl.length) {
    // the nearest stored content: the Y with the fewest closure paths changed
    let best = null;
    for (const [c] of yl) { const t = touchedPaths(x.file, changed(target, c)); if (t && (best === null || t.length < best.n)) best = { c, n: t.length, paths: t.slice(0, 8) }; }
    out.nearest = best;
  }
  console.log(JSON.stringify(out));
}
