// 011-152 probe (throwaway): for each first-start miss, is there an earlier stored row of the file at a commit whose closure content equals the miss's commit?
// Usage: node content.mjs <store copy> <first.jsonl> <git dir> <out.jsonl>
// Closure of a file = its stored closure list + its observed set + the policy inputs that select it (all as stored now, so inferred for the past),
// hashed from `git ls-tree -r <commit>`. A listing path ("dir/") is the sorted tracked entry names below it.
import { DatabaseSync } from "node:sqlite"; import { readFileSync, writeFileSync } from "node:fs"; import { execFileSync } from "node:child_process"; import { createHash } from "node:crypto";
const [, , storePath, firstPath, gitDir, outPath] = process.argv;
const db = new DatabaseSync(storePath, { readOnly: true });
const misses = readFileSync(firstPath, "utf8").trim().split("\n").map((l) => JSON.parse(l));
const closures = new Map(db.prepare("SELECT project, path, closure_paths FROM test_files").all().map((t) => [t.project + "\0" + t.path, JSON.parse(t.closure_paths)]));
const observed = new Map();
for (const m of db.prepare("SELECT key, value FROM meta WHERE key LIKE 'observed.%'").all()) for (const [t, ps] of Object.entries(JSON.parse(m.value))) observed.set(m.key.slice(9) + "\0" + t, ps);
const glob = (g) => new RegExp("^" + g.split("**/").map((s) => s.split("**").map((x) => x.split("*").map((y) => y.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join("[^/]*")).join(".*")).join("(?:.*/)?") + "$");
const inputs = Object.entries(JSON.parse(readFileSync(gitDir + "/../squeal.config.json", "utf8")).inputs ?? {}).map(([k, v]) => [glob(k), v.map(glob)]);
const commitOf = db.prepare("SELECT commit_sha c, dirty d FROM results WHERE worktree_id = ? AND revision = ? LIMIT 1");
const fileCheck = db.prepare("SELECT id FROM checks WHERE kind = 'file' AND project = ? AND test_path = ?");
const rowsOf = db.prepare("SELECT key, worktree_id w, revision, commit_sha c, dirty d, recorded_at at FROM results WHERE check_id = ? ORDER BY recorded_at");
const live = new Set(db.prepare("SELECT id FROM worktrees").all().map((r) => r.id));
const trees = new Map();
function tree(c) {
  if (trees.has(c)) return trees.get(c);
  let m = null;
  try { m = new Map(execFileSync("git", ["--git-dir", gitDir, "ls-tree", "-r", "--full-tree", c], { maxBuffer: 1 << 28 }).toString().trim().split("\n").map((l) => { const [meta, p] = l.split("\t"); return [p, meta.split(" ")[2]]; })); } catch {}
  trees.set(c, m); return m;
}
function sig(file, c) {
  const t = tree(c); if (!t) return null;
  const [p, path] = file.split("\0");
  const set = new Set([...(closures.get(file) ?? [path]), ...(observed.get(file) ?? [])]);
  for (const [re, gs] of inputs) if (re.test(path)) for (const q of t.keys()) if (gs.some((g) => g.test(q))) set.add(q);
  const h = createHash("sha256");
  for (const q of [...set].sort()) {
    if (q.endsWith("/") || q === "./") { const d = q === "./" ? "" : q; const names = new Set(); for (const k of t.keys()) if (k.startsWith(d)) names.add(k.slice(d.length).split("/")[0]); h.update(q + "\0" + [...names].sort().join("/") + "\0"); }
    else h.update(q + "\0" + (t.get(q) ?? "-") + "\0");
  }
  return h.digest("hex");
}
const out = [];
for (const m of misses) {
  const at = commitOf.get(m.w, m.ckRev);
  const X = at?.c ?? m.commit, dirty = at ? at.d : m.dirty;
  const o = { ...m, X, Xdirty: dirty };
  delete o.sameKeyBefore; delete o.sameCommitBefore; delete o.newestBefore;
  if (!X || dirty !== 0) { o.cls = !X ? "commit unknown" : "start dirty"; out.push(o); continue; }
  const s = sig(m.file, X);
  const check = fileCheck.get(...m.file.split("\0"))?.id;
  const rows = check ? rowsOf.all(check).filter((r) => r.at < m.ckStart && r.w !== m.w && r.d === 0 && r.c) : [];
  const equal = rows.filter((r) => sig(m.file, r.c) === s);
  o.rowsBefore = rows.length; o.equalContent = equal.map((r) => ({ w: r.w, live: live.has(r.w), key: r.key, c: r.c, at: r.at }));
  o.cls = s === null ? "commit not in git" : equal.length ? (equal.some((r) => r.key === m.key) ? "equal content, equal key stored before" : "equal content stored before, different key") : rows.length ? "no stored row at equal content" : "no clean stored row of the file before";
  out.push(o);
}
writeFileSync(outPath, out.map((o) => JSON.stringify(o)).join("\n") + "\n");
const by = {}; for (const o of out) { const k = `${o.live ? "live" : "removed"}: ${o.cls}`; by[k] ??= [0, 0, 0]; by[k][0]++; by[k][1] += o.secs ?? 0; if (o.ran) by[k][2]++; }
for (const [k, [n, s, r]] of Object.entries(by).sort((a, b) => b[1][1] - a[1][1])) console.log(`${Math.round(s)} s, ${n} misses (${r} ran): ${k}`);
