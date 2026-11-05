// 011-299 probe (throwaway): question 4. For each first-baseline file run, its closure content (git blobs of the
// closure paths, the shared observed set and the runner files at the run's commit) compared with the content at the
// origin/main commit that was main's tip some minutes before the run started: the upper bound of a daemon on the
// main checkout that validates origin/main after each pull. Also: file runs whose content an earlier first-baseline
// run in another worktree already ran (content repeats).
// Usage: node levers.cjs <store copy> <classes.cls.jsonl> <git dir> [lag minutes, comma list; default 0,30,120]
const { DatabaseSync } = require("node:sqlite");
const { execFileSync } = require("child_process");
const { createHash } = require("crypto");
const fs = require("fs");
const [, , storePath, clsPath, gitDir, lagArg] = process.argv;
const LAGS = (lagArg ?? "0,30,120").split(",").map(Number);
const db = new DatabaseSync(storePath, { readOnly: true });
const git = (...a) => execFileSync("git", ["-C", gitDir, ...a], { encoding: "utf8", maxBuffer: 1 << 28 });
const L = fs.readFileSync(clsPath, "utf8").trim().split("\n").map((l) => JSON.parse(l));
const closure = new Map();
for (const r of db.prepare("select project, path, closure_paths from test_files").all()) closure.set(r.project + "\0" + r.path, new Set(JSON.parse(r.closure_paths)));
for (const m of db.prepare("select key, value from meta where key like 'observed.%'").all()) {
  const project = m.key.slice("observed.".length);
  for (const [t, ps] of Object.entries(JSON.parse(m.value))) { const k = project + "\0" + t; const s = closure.get(k) ?? closure.set(k, new Set()).get(k); for (const p of ps) s.add(p); }
}
const ENV = /(^|\/)(vitest\.[^/]*|pnpm-lock\.yaml|pnpm-workspace\.yaml|\.npmrc|squeal\.config\.json|playwright\.config\.[^/]*)$/;
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
const envPaths = new Map();
const fps = new Map();
const fp = (file, c) => {
  const k = file + "\0" + c; if (fps.has(k)) return fps.get(k);
  const t = treeOf(c); let v = null;
  if (t) {
    if (!envPaths.has(c)) envPaths.set(c, [...t.keys()].filter((p) => ENV.test(p)).sort());
    const cl = [...(closure.get(file) ?? [file.split("\0")[1]])].sort();
    const h = createHash("sha1");
    for (const p of cl) {
      if (p.endsWith("/")) { const d = p === "./" ? "" : p; const names = new Set(); for (const q of t.keys()) if (q.startsWith(d)) names.add(q.slice(d.length).split("/")[0]); h.update(p + "\0" + [...names].sort().join("/") + "\0"); }
      else h.update(p + "\0" + (t.get(p) ?? "-") + "\0");
    }
    for (const p of envPaths.get(c)) h.update(p + "\0" + t.get(p) + "\0");
    v = h.digest("hex");
  }
  fps.set(k, v); return v;
};
const main = git("log", "--first-parent", "origin/main", "--format=%H %ct", "--since=2026-10-28").trim().split("\n").map((l) => { const [h, t] = l.split(" "); return { h, t: Number(t) * 1000 }; }).sort((a, b) => a.t - b.t);
const mainT = new Map(main.map((m) => [m.h, m.t]));
const bases = new Map();
const baseOf = (c) => { if (!bases.has(c)) { let b = null; try { b = git("merge-base", c, "origin/main").trim(); } catch {} bases.set(c, b); } return bases.get(c); };
const tipAt = (t) => { let lo = 0, hi = main.length - 1, r = null; while (lo <= hi) { const m = (lo + hi) >> 1; if (main[m].t <= t) { r = main[m]; lo = m + 1; } else hi = m - 1; } return r; };
const S = new Map(); let tot = 0;
const add = (k, x) => { const v = S.get(k) ?? { n: 0, sec: 0 }; v.n++; v.sec += x.sec; S.set(k, v); };
const seenContent = new Map(); // file+fp -> first worktree
const sorted = [...L].sort((a, b) => a.rs - b.rs);
for (const x of sorted) {
  if (x.c.startsWith("not ended")) continue;
  tot += x.sec;
  const cls = x.c.slice(0, 2).trim();
  const own = x.c.startsWith("e-own");
  const commit = own ? x.X : x.X0;
  const f = commit ? fp(x.file, commit) : null;
  if (f) {
    const k = x.file + "\0" + f;
    const w = seenContent.get(k);
    if (w !== undefined && w !== x.W) add(`repeat: content an earlier first baseline in another worktree ran (${cls})`, x);
    if (w === undefined) seenContent.set(k, x.W);
  }
  // candidates a daemon validating each origin/main commit as it lands would hold: the run's base on main, and
  // main's tip, each only if it landed at least `lag` minutes before the run started
  const base = commit ? baseOf(commit) : null;
  for (const lag of LAGS) {
    const by = x.rs - lag * 60e3, tip = tipAt(by);
    const cands = [tip?.h, base !== null && (mainT.get(base) ?? Infinity) <= by ? base : null].filter(Boolean);
    if (f && cands.some((c) => fp(x.file, c) === f)) { add(`lag ${String(lag).padStart(3)} min: a main commit has the same content (${cls})`, x); add(`lag ${String(lag).padStart(3)} min: a main commit has the same content (all)`, x); }
  }
}
console.log(`file runs that ended: recorded s ${Math.round(tot)}`);
for (const [k, v] of [...S].sort((a, b) => (a[0] < b[0] ? -1 : 1))) console.log(`${(100 * v.sec / tot).toFixed(1).padStart(5)}% ${String(Math.round(v.sec)).padStart(7)} s ${String(v.n).padStart(6)} runs  ${k}`);
