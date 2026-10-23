// 011-152 probe (throwaway): for each first-start miss with no stored row at equal content (content.mjs), an earlier run that completed the file at a
// clean commit of equal closure content, by its report in the run-log snapshot, and what became of its row.
// Usage: node earlier.mjs <store copy> <run-log snapshot> <content.jsonl> <git dir> <out.jsonl>
import { DatabaseSync } from "node:sqlite"; import { readFileSync, writeFileSync, existsSync } from "node:fs"; import { execFileSync } from "node:child_process"; import { createHash } from "node:crypto";
const [, , storePath, logs, contentPath, gitDir, outPath] = process.argv;
const db = new DatabaseSync(storePath, { readOnly: true });
const misses = readFileSync(contentPath, "utf8").trim().split("\n").map((l) => JSON.parse(l));
const closures = new Map(db.prepare("SELECT project, path, closure_paths FROM test_files").all().map((t) => [t.project + "\0" + t.path, JSON.parse(t.closure_paths)]));
const observed = new Map();
for (const m of db.prepare("SELECT key, value FROM meta WHERE key LIKE 'observed.%'").all()) for (const [t, ps] of Object.entries(JSON.parse(m.value))) observed.set(m.key.slice(9) + "\0" + t, ps);
const glob = (g) => new RegExp("^" + g.split("**/").map((s) => s.split("**").map((x) => x.split("*").map((y) => y.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join("[^/]*")).join(".*")).join("(?:.*/)?") + "$");
const inputs = Object.entries(JSON.parse(readFileSync(gitDir + "/../squeal.config.json", "utf8")).inputs ?? {}).map(([k, v]) => [glob(k), v.map(glob)]);
const trees = new Map();
function tree(c) { if (trees.has(c)) return trees.get(c); let m = null; try { m = new Map(execFileSync("git", ["--git-dir", gitDir, "ls-tree", "-r", "--full-tree", c], { maxBuffer: 1 << 28 }).toString().trim().split("\n").map((l) => { const [meta, p] = l.split("\t"); return [p, meta.split(" ")[2]]; })); } catch {} trees.set(c, m); return m; }
function sig(file, c) {
  const t = tree(c); if (!t) return null; const path = file.split("\0")[1];
  const set = new Set([...(closures.get(file) ?? [path]), ...(observed.get(file) ?? [])]);
  for (const [re, gs] of inputs) if (re.test(path)) for (const q of t.keys()) if (gs.some((g) => g.test(q))) set.add(q);
  const h = createHash("sha256");
  for (const q of [...set].sort()) { if (q.endsWith("/") || q === "./") { const d = q === "./" ? "" : q; const names = new Set(); for (const k of t.keys()) if (k.startsWith(d)) names.add(k.slice(d.length).split("/")[0]); h.update(q + "\0" + [...names].sort().join("/") + "\0"); } else h.update(q + "\0" + (t.get(q) ?? "-") + "\0"); }
  return h.digest("hex");
}
const live = new Set(db.prepare("SELECT id FROM worktrees").all().map((r) => r.id));
// Every run with a report: its commit and dirtiness (a stored row of the run, else the live worktree's revision), its completed files.
const runCommit = db.prepare("SELECT commit_sha c, dirty d FROM results WHERE run_id = ? LIMIT 1");
const revRow = db.prepare("SELECT head c, dirty d FROM revisions WHERE worktree_id = ? AND number = ?");
const wtRev = db.prepare("SELECT commit_sha c, dirty d FROM results WHERE worktree_id = ? AND revision = ? LIMIT 1");
const fileRow = db.prepare("SELECT r.key FROM results r JOIN checks c ON c.id = r.check_id WHERE c.kind = 'file' AND c.project = ? AND c.test_path = ? AND r.run_id = ?");
const byFile = new Map();
for (const run of db.prepare("SELECT * FROM runs WHERE ended_at IS NOT NULL").all()) {
  const p = logs + "/" + run.log_dir.split("/").pop() + "/report.json"; if (!existsSync(p)) continue;
  let rep; try { rep = JSON.parse(readFileSync(p, "utf8")).report; } catch { continue; }
  const at = runCommit.get(run.id) ?? revRow.get(run.worktree_id, run.revision) ?? wtRev.get(run.worktree_id, run.revision);
  if (!at || at.d !== 0 || !at.c) continue;
  const fails = new Set((rep.results ?? []).filter((r) => r.outcome === "fail").map((r) => r.check.project + "\0" + r.check.testPath));
  for (const d of rep.fileDurations ?? []) { const id = d.testFile.project + "\0" + d.testFile.path; (byFile.get(id) ?? byFile.set(id, []).get(id)).push({ run: run.id, w: run.worktree_id, c: at.c, end: run.ended_at, secs: d.durationMs / 1000, fail: fails.has(id) }); }
}
const out = [];
for (const m of misses) {
  if (!["no stored row at equal content", "no clean stored row of the file before"].includes(m.cls)) continue;
  const s = sig(m.file, m.X);
  const prior = (byFile.get(m.file) ?? []).filter((r) => r.end < m.ckStart && r.w !== m.w && sig(m.file, r.c) === s);
  const o = { w: m.w, live: m.live, ck: m.ck, ckStart: m.ckStart, file: m.file, ran: m.ran, secs: m.secs, X: m.X, cls: m.cls };
  if (prior.length) {
    const last = prior.at(-1); const [p, t] = m.file.split("\0");
    o.prior = { n: prior.length, w: last.w, wLive: live.has(last.w), c: last.c, end: last.end, gapMin: Math.round((m.ckStart - last.end) / 60000), rowNow: fileRow.get(p, t, last.run)?.key ?? null, fail: last.fail };
    o.cls2 = "an earlier run completed it at equal content; " + (o.prior.rowNow ? "its row is stored (key differs)" : live.has(last.w) ? "its row is gone, worktree live (replaced or 7-day)" : "its row is gone, worktree removed (prune)");
  } else o.cls2 = "no earlier run with a report completed it at equal content";
  out.push(o);
}
writeFileSync(outPath, out.map((o) => JSON.stringify(o)).join("\n") + "\n");
const by = {}; for (const o of out) { const k = `${o.live ? "live" : "removed"}: ${o.cls2}`; by[k] ??= [0, 0]; by[k][0]++; by[k][1] += o.secs ?? 0; }
for (const [k, [n, s]] of Object.entries(by).sort((a, b) => b[1][1] - a[1][1])) console.log(`${Math.round(s)} s, ${n} misses: ${k}`);
