// 011-148 probe (throwaway): baseline file runs at a worktree's first revision: had another worktree already stored the file at the same clean commit?
// Usage: node miss.mjs <store copy> <fate.jsonl>
import { DatabaseSync } from "node:sqlite"; import { readFileSync } from "node:fs";
const [, , storePath, fatePath] = process.argv;
const db = new DatabaseSync(storePath, { readOnly: true });
const fate = readFileSync(fatePath, "utf8").trim().split("\n").map((l) => JSON.parse(l));
const rev = db.prepare("SELECT head, dirty FROM revisions WHERE worktree_id = ? AND number = ?");
const prior = db.prepare(`SELECT count(*) n, count(DISTINCT r.key) k FROM results r JOIN checks c ON c.id = r.check_id
  WHERE c.kind = 'file' AND c.project = ? AND c.test_path = ? AND r.commit_sha = ? AND r.dirty = 0 AND r.worktree_id <> ? AND r.recorded_at < ?`);
const t = {}; const add = (k, s) => { t[k] ??= [0, 0]; t[k][0] += s; t[k][1]++; };
for (const f of fate.filter((f) => f.ck === "baseline" && f.live)) {
  const r = rev.get(f.w, f.rev);
  if (!r) { add("no revision row", f.secs); continue; }
  if (r.dirty) { add("dirty worktree at the run's revision", f.secs); continue; }
  const [p, path] = f.file.split("\0");
  const n = prior.get(p, path, r.head, f.w, f.start);
  add(n.n > 0 ? "clean; another worktree had stored this file at the same commit before (a key differed)" : "clean; no stored result of this file at this commit before", f.secs);
}
for (const [k, [s, n]] of Object.entries(t).sort((a, b) => b[1][0] - a[1][0])) console.log(`${Math.round(s)} s, ${n} file runs: ${k}`);
