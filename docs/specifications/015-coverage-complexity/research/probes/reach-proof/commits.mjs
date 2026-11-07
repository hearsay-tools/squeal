import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync(process.argv[2], { readOnly: true });
const since = Date.now() - Number(process.argv[3] ?? 5) * 86400e3;
const rows = db.prepare(`select r.commit_sha c, count(distinct c.project||'|'||c.test_path) files, max(r.recorded_at) at
  from results r join checks c on c.id = r.check_id where r.dirty = 0 and r.recorded_at > ? and r.commit_sha is not null
  group by r.commit_sha order by files desc limit 15`).all(since);
for (const r of rows) console.log(r.c.slice(0, 10), r.files, new Date(r.at).toISOString());
console.log("test files listed (any worktree):", db.prepare("select count(*) n from test_files").get().n);
