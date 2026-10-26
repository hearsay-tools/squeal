// 015-14 part B: a worktree's test files whose current result has no coverage record (D9 `no-record`), read only.
import { DatabaseSync } from "node:sqlite";
const wt = process.argv[2];
const main = new DatabaseSync("/home/agent/projects/squeal/.git/squeal/store.sqlite", { readOnly: true });
const code = new DatabaseSync("/home/agent/projects/squeal/.git/squeal/code.sqlite", { readOnly: true });
const keys = main.prepare("select project, path, key from test_file_keys where worktree_id = ? and key is not null and pending is null").all(wt);
const res = main.prepare("select r.outcome, r.worktree_id, r.recorded_at, r.run_id from results r join checks c on c.id = r.check_id where r.key = ? and c.test_path = ? limit 50");
const rec = code.prepare("select recorded_at from coverage where result_key = ? and provider_version = 2");
const out = { keys: keys.length, withResult: 0, withRecord: 0, noRecord: 0, skipped: 0, byOrigin: {}, byDay: {}, examples: [] };
for (const k of keys) {
  const rs = res.all(k.key, k.path);
  if (rs.length === 0) continue;
  out.withResult++;
  if (rs.some((r) => r.outcome === "skip")) out.skipped++;
  if (rec.get(k.key)) { out.withRecord++; continue; }
  out.noRecord++;
  const origin = rs[0].worktree_id === wt ? "own run" : "another worktree's run";
  out.byOrigin[origin] = (out.byOrigin[origin] ?? 0) + 1;
  const hour = new Date(Math.max(...rs.map((r) => r.recorded_at))).toISOString().slice(0, 13);
  out.byDay[hour] = (out.byDay[hour] ?? 0) + 1;
  if (out.examples.length < 8) out.examples.push(`${k.path} ${hour} ${origin}`);
}
console.log(JSON.stringify(out, null, 1));
