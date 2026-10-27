import { DatabaseSync } from "node:sqlite";
const dir = "/home/agent/projects/squeal/.git/squeal/";
const s = new DatabaseSync(dir + "store.sqlite", { readOnly: true });
s.exec(`attach database 'file:${dir}code.sqlite?mode=ro' as c`);
const p = process.argv[2];
const rows = s.prepare(`select r.key, r.outcome, r.duration_ms d, r.worktree_id w, r.recorded_at t, r.run_id, u.end_state, json_array_length(u.test_files) nf, u.checkpoint_id cp,
  (select recorded_at from c.coverage v where v.result_key=r.key) cov
  from results r join checks k on k.id=r.check_id join runs u on u.id=r.run_id where k.kind='file' and k.test_path=? order by r.recorded_at`).all(p);
for (const r of rows) console.log(new Date(r.t).toISOString(), r.w.slice(0,8), r.run_id.slice(0,8), r.outcome, r.end_state, "files", r.nf, Math.round(r.d/1000)+"s", r.cov === null ? "NO RECORD" : "record +" + Math.round((r.cov - r.t)/1000) + "s");
