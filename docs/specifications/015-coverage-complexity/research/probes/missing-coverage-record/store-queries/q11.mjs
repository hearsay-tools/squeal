import { DatabaseSync } from "node:sqlite";
const dir = "/home/agent/projects/squeal/.git/squeal/";
const s = new DatabaseSync(dir + "store.sqlite", { readOnly: true });
s.exec(`attach database 'file:${dir}code.sqlite?mode=ro' as c`);
const since = Date.parse(process.argv[2]);
const runs = s.prepare(`select id, worktree_id w, started_at, ended_at from runs where end_state='completed' and ended_at > ? order by ended_at`).all(since);
const res = s.prepare(`select r.outcome, (select 1 from c.coverage v where v.result_key=r.key) cov from results r join checks k on k.id=r.check_id where r.run_id=? and k.kind='file'`);
const next = s.prepare(`select started_at t, id from runs where worktree_id=? and started_at > ? and id <> ? order by started_at limit 1`);
const overl = s.prepare(`select count(*) n from runs where worktree_id=? and id<>? and started_at < ? and coalesce(ended_at, 9e15) > ?`);
const t = { };
const add = (k, miss) => { t[k] ??= { runs: 0, withMiss: 0 }; t[k].runs++; if (miss) t[k].withMiss++; };
for (const u of runs) {
  const rs = res.all(u.id);
  if (!rs.some(r => r.cov === 1)) continue;
  const miss = rs.some(r => r.cov === null && r.outcome === 'pass');
  const n = next.get(u.w, u.started_at, u.id);
  const gap = n === undefined ? null : n.t - u.ended_at;
  add(gap === null ? "no next run" : gap < 0 ? "next run started before this ended (overlap)" : gap < 3000 ? "next within 3 s" : gap < 30000 ? "next 3-30 s" : "next after 30 s", miss);
  add(overl.get(u.w, u.id, u.ended_at, u.started_at).n > 0 ? "ALL: another run overlapped" : "ALL: no overlap", miss);
}
for (const [k, v] of Object.entries(t)) console.log(k.padEnd(48), v.runs, "runs,", v.withMiss, "with a missing record,", (100 * v.withMiss / v.runs).toFixed(1) + "%");
