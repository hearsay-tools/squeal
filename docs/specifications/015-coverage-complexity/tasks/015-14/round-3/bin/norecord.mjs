// 015-14 Round 3: a worktree's test files whose current result has no
// coverage record (D9 `no-record`), read only. Round 2's part-b/bin/norecord.mjs
// with the store directory as an argument, and each such file split by the
// run that made its newest result: a run of this worktree that started at or
// after <since> (its current daemon, when <since> is the daemon's start), an
// older run of this worktree, or another worktree's run.
// Usage: node norecord.mjs <.git/squeal dir> <worktree id> <since, ISO time>
import { DatabaseSync } from "node:sqlite";

const [dir, wt, sinceIso] = process.argv.slice(2);
const since = Date.parse(sinceIso);
const open = (name) => {
  const db = new DatabaseSync(`${dir}/${name}`, { readOnly: true });
  db.exec("PRAGMA query_only = 1; PRAGMA busy_timeout = 5000");
  return db;
};
const main = open("store.sqlite");
const code = open("code.sqlite");
const keys = main
  .prepare("SELECT project, path, key FROM test_file_keys WHERE worktree_id = ? AND key IS NOT NULL AND pending IS NULL")
  .all(wt);
const res = main.prepare(`SELECT r.outcome, r.worktree_id, r.recorded_at, r.run_id, u.started_at, u.end_state
  FROM results r JOIN checks c ON c.id = r.check_id LEFT JOIN runs u ON u.id = r.run_id
  WHERE r.key = ? AND c.test_path = ? ORDER BY r.recorded_at DESC LIMIT 50`);
const rec = code.prepare("SELECT recorded_at FROM coverage WHERE result_key = ? AND provider_version = 2");
const out = { worktree: wt, since: sinceIso, keys: keys.length, withResult: 0, withRecord: 0, noRecord: 0, skipped: 0, newest: null, byOrigin: {}, byEnd: {}, examples: [] };
for (const k of keys) {
  const rs = res.all(k.key, k.path);
  if (rs.length === 0) continue;
  out.withResult++;
  if (rs.some((r) => r.outcome === "skip")) out.skipped++;
  if (rec.get(k.key)) {
    out.withRecord++;
    continue;
  }
  out.noRecord++;
  const r = rs[0];
  const origin =
    r.worktree_id !== wt ? "another worktree's run" : Number(r.started_at ?? r.recorded_at) >= since ? "a run since <since>" : "an older run";
  out.byOrigin[origin] = (out.byOrigin[origin] ?? 0) + 1;
  out.byEnd[r.end_state ?? "none"] = (out.byEnd[r.end_state ?? "none"] ?? 0) + 1;
  const at = new Date(Number(r.recorded_at)).toISOString();
  if (out.newest === null || at > out.newest) out.newest = at;
  if (out.examples.length < 10) out.examples.push(`${k.path} ${at} ${origin} ${r.end_state}`);
}
console.log(JSON.stringify(out, null, 1));
