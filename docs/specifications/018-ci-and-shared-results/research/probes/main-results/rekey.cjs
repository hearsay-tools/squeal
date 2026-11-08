// main-results probe (throwaway): question 5, generated from prize.cjs (same content rule, same main walk).
// CI cost of an incremental export: a job on each main commit with finished CI that keeps the previous such commit's
// results and runs only the files whose content changed since then. Seconds per file: the median of its local
// recorded seconds. Prints per day: commits, files re-run, seconds; and the same if the job ran on every main commit.
// Usage: node rekey.cjs <store copy> <runs.jsonl> <ci.jsonl> <git dir> <main since ISO> <from ISO> <to ISO>
// (prize.cjs header, kept for its definitions:) For each local file run (extract.cjs), whether its closure
// content at the run's commit equals the content at a main commit whose CI main-push run had finished before the
// run started.
// Usage: node prize.cjs <store copy> <runs.jsonl> <ci.jsonl> <git dir> <main since ISO> [extra trusted runs.jsonl] > prize.jsonl
// Content of a file at a commit (as 011-299's levers.cjs): the git blobs of its closure (test_files.closure_paths
// plus its entry in the store's observed sets; a directory entry by its child names) and of the files that feed the
// environment hash (vitest configs, lockfiles, workspace and squeal config). Today's closure stands for the closure
// at each run: an approximation. Node version, CI settings and coverage are taken as equal (question 3).
// Main commits: first-parent origin/main since <main since>. A commit "landed" at the first time the local
// origin/main reflog or a GitHub push run shows main at it or at a later commit; its committer time when neither does. CI "finished" at the updated_at of a completed push run for that
// SHA that was not cancelled (success or failure: a failed run still records passes).
// One output line per input line, with: m.ci (equal to a main commit with CI finished before the run started, any
// such commit: a store that keeps every main bundle), m.near (equal to the newest main commit with finished CI that
// is an ancestor of the run's base on main: a daemon that imports one bundle), m.landed (equal to any main commit that
// landed before the run, CI or not: the bound with CI taking no time), ciAge (s from the earliest such CI finish to
// the run start), and m.later (equal to a main commit whose CI finished after the run started: lost to CI's lag).
const { DatabaseSync } = require("node:sqlite");
const { execFileSync } = require("child_process");
const { createHash } = require("crypto");
const fs = require("fs");
const [, , storePath, runsPath, ciPath, gitDir, sinceIso, fromIso, toIso] = process.argv; const extraCiPath = null;
const db = new DatabaseSync(storePath, { readOnly: true });
const git = (...a) => execFileSync("git", ["-C", gitDir, ...a], { encoding: "utf8", maxBuffer: 1 << 30 });
const closure = new Map();
for (const r of db.prepare("select project, path, closure_paths from test_files").all()) closure.set(r.project + "\0" + r.path, new Set(JSON.parse(r.closure_paths)));
for (const m of db.prepare("select key, value from meta where key like 'observed.%'").all()) {
  const project = m.key.slice("observed.".length);
  for (const [t, ps] of Object.entries(JSON.parse(m.value))) { const k = project + "\0" + t; const s = closure.get(k) ?? closure.set(k, new Set()).get(k); for (const p of ps) s.add(p); }
}
const closureOf = (file) => { if (!closure.has(file)) closure.set(file, new Set([file.split("\0")[1]])); return closure.get(file); };
const sortedOf = new Map(), dirsOf = new Map();
const sorted = (file) => { if (!sortedOf.has(file)) { const a = [...closureOf(file)].sort(); sortedOf.set(file, a); dirsOf.set(file, a.filter((p) => p.endsWith("/"))); } return sortedOf.get(file); };
const ENV = /(^|\/)(vitest\.[^/]*|vitest\.workspace\.[^/]*|pnpm-lock\.yaml|package-lock\.json|pnpm-workspace\.yaml|\.npmrc|squeal\.config\.json|playwright\.config\.[^/]*)$/;
// trees, with a small cache
const trees = new Map();
const treeOf = (c) => {
  if (trees.has(c)) { const t = trees.get(c); trees.delete(c); trees.set(c, t); return t; }
  let t = null;
  try {
    const files = new Map(), dirs = new Map();
    for (const line of git("ls-tree", "-r", "--full-tree", c).split("\n")) {
      if (!line) continue; const i = line.indexOf("\t"); const p = line.slice(i + 1); files.set(p, line.slice(0, i).split(" ")[2]);
      const parts = p.split("/"); let d = "";
      for (let k = 0; k < parts.length; k++) { const key = d === "" ? "./" : d; const s = dirs.get(key) ?? dirs.set(key, new Set()).get(key); s.add(parts[k]); d += parts[k] + "/"; }
    }
    const env = [...files.keys()].filter((p) => ENV.test(p)).sort().map((p) => p + "\0" + files.get(p)).join("\0");
    t = { files, dirs, env };
  } catch { t = null; }
  trees.set(c, t); if (trees.size > 40) trees.delete(trees.keys().next().value);
  return t;
};
const fpCache = new Map();
const fp = (file, c) => {
  const k = file + "\0" + c; if (fpCache.has(k)) return fpCache.get(k);
  const t = treeOf(c); let v = null;
  if (t) {
    const h = createHash("sha1");
    for (const p of sorted(file)) {
      if (p.endsWith("/")) h.update(p + "\0" + [...(t.dirs.get(p) ?? [])].sort().join("/") + "\0");
      else h.update(p + "\0" + (t.files.get(p) ?? "-") + "\0");
    }
    h.update(t.env); v = h.digest("hex");
  }
  fpCache.set(k, v); return v;
};
// main commits, landing and CI times
const ci = fs.readFileSync(ciPath, "utf8").trim().split("\n").map((l) => JSON.parse(l));
const pushAt = new Map(), ciAt = new Map();
for (const r of ci) {
  const c = Date.parse(r.created_at); if (!pushAt.has(r.head_sha) || c < pushAt.get(r.head_sha)) pushAt.set(r.head_sha, c);
  if (r.status === "completed" && r.conclusion !== "cancelled" && r.conclusion !== "skipped" && r.conclusion) { const u = Date.parse(r.updated_at); if (!ciAt.has(r.head_sha) || u < ciAt.get(r.head_sha)) ciAt.set(r.head_sha, u); }
}
// optional: runs of other trusted pushes (squeal's cand/** branches) that tested a commit later on main's first-parent
// line; they move that commit's CI time earlier, never its landing time
if (extraCiPath) for (const r of fs.readFileSync(extraCiPath, "utf8").trim().split("\n").map((l) => JSON.parse(l))) {
  if (r.status === "completed" && r.conclusion !== "cancelled" && r.conclusion !== "skipped" && r.conclusion) { const u = Date.parse(r.updated_at); if (!ciAt.has(r.head_sha) || u < ciAt.get(r.head_sha)) ciAt.set(r.head_sha, u); }
}
const main = git("log", "--first-parent", "origin/main", "--format=%H %ct", `--since=${sinceIso}`).trim().split("\n").map((l) => { const [h, t] = l.split(" "); return { h, committed: Number(t) * 1000, ci: ciAt.get(h) ?? null }; }).reverse();
const idx = new Map(main.map((m, i) => [m.h, i]));
// landing: the first time a ref update or a push run shows main at this commit or a later one (the local
// origin/main reflog, which pushes from this host and fetches update; GitHub push runs); else the committer time
const seenAt = new Array(main.length).fill(Infinity);
for (const [h, t] of pushAt) if (idx.has(h)) seenAt[idx.get(h)] = Math.min(seenAt[idx.get(h)], t);
for (const l of git("reflog", "show", "--date=unix", "--format=%H %gd", "refs/remotes/origin/main").trim().split("\n")) {
  const m = /^([0-9a-f]+) .*@\{(\d+)\}$/.exec(l); if (m && idx.has(m[1])) seenAt[idx.get(m[1])] = Math.min(seenAt[idx.get(m[1])], Number(m[2]) * 1000);
}
for (let i = main.length - 1, best = Infinity; i >= 0; i--) { best = Math.min(best, seenAt[i]); main[i].landed = best === Infinity ? main[i].committed : Math.max(main[i].committed, best);
  // a bundle is published from main, so it is never there before the commit landed (matters for the extra runs)
  if (main[i].ci !== null) main[i].ci = Math.max(main[i].ci, main[i].landed); }
// per file: content id per main commit, walked in order; a commit whose diff from the previous one misses the closure,
// the environment files and every closure directory keeps the previous content
const lines = fs.readFileSync(runsPath, "utf8").trim().split("\n").map((l) => JSON.parse(l));
const files = [...new Set(lines.map((x) => x.file))];
const mainFp = new Map(files.map((f) => [f, new Array(main.length)]));
for (let i = 0; i < main.length; i++) {
  let changed = null;
  if (i > 0) changed = git("diff", "--no-renames", "--name-status", main[i - 1].h, main[i].h).trim().split("\n").filter(Boolean).map((l) => { const [s, p] = l.split("\t"); return { s, p }; });
  const envTouched = changed !== null && changed.some((x) => ENV.test(x.p));
  for (const f of files) {
    const arr = mainFp.get(f);
    if (changed !== null && !envTouched) {
      const cl = closureOf(f);
      sorted(f); const ds = dirsOf.get(f);
      const hit = changed.some((x) => cl.has(x.p) || (x.s !== "M" && ds.some((d) => d === "./" || x.p.startsWith(d))));
      if (!hit) { arr[i] = arr[i - 1]; continue; }
    }
    arr[i] = fp(f, main[i].h);
  }
  fpCache.clear();
  if (i % 250 === 0) process.stderr.write(`main ${i}/${main.length} ${new Date().toISOString()}\n`);
}
const med = new Map();
{ const by = new Map(); for (const x of lines) (by.get(x.file) ?? by.set(x.file, []).get(x.file)).push(x.sec);
  for (const [f, a] of by) { a.sort((p, q) => p - q); med.set(f, a[a.length >> 1]); } }
const F = Date.parse(fromIso), T = Date.parse(toIso), days = (T - F) / 864e5;
const tally = (pick) => { let commits = 0, files = 0, sec = 0, prev = -1;
  for (let i = 0; i < main.length; i++) { if (!pick(main[i])) continue;
    if (prev >= 0 && main[i].landed >= F && main[i].landed < T) { commits++; for (const f of files_) { const a = mainFp.get(f); if (a[i] !== a[prev]) { files++; sec += med.get(f); } } }
    prev = i; }
  return { commitsPerDay: +(commits / days).toFixed(1), filesPerCommit: commits ? Math.round(files / commits) : 0, hoursPerDay: +(sec / days / 3600).toFixed(1), secPerCommit: commits ? Math.round(sec / commits) : 0 }; };
const files_ = files;
const all = files.reduce((n, f) => n + med.get(f), 0);
console.log(JSON.stringify({ days: +days.toFixed(2), suiteSecondsByMedians: Math.round(all), onCiCommits: tally((m) => m.ci !== null), onEveryMainCommit: tally(() => true) }));
