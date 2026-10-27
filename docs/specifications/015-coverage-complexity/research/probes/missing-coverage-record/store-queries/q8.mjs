import { DatabaseSync } from "node:sqlite";
const dir = "/home/agent/projects/squeal/.git/squeal/";
const s = new DatabaseSync(dir + "store.sqlite", { readOnly: true });
s.exec(`attach database 'file:${dir}code.sqlite?mode=ro' as c`);
const run = s.prepare("select * from runs where id like ?").get(process.argv[2] + "%");
const t0 = run.ended_at;
console.log(run.id, run.worktree_id, "rev", run.revision, new Date(run.started_at).toISOString(), "->", new Date(t0).toISOString(), run.end_state);
console.log(s.prepare("select id, daemon_started_at, daemon_heartbeat_at, daemon_version from worktrees where id=?").get(run.worktree_id));
const rs = s.prepare(`select k.test_path p, r.outcome, r.key, r.recorded_at t, r.duration_ms d, (select recorded_at from c.coverage v where v.result_key=r.key) cov,
  (select count(*) from results r2 where r2.key=r.key and r2.run_id<>r.run_id) other from results r join checks k on k.id=r.check_id where r.run_id=? and k.kind='file'`).all(run.id);
const covs = rs.filter(r=>r.cov!==null).map(r=>(r.cov-t0)/1000).sort((a,b)=>a-b);
console.log("files", rs.length, "records", covs.length, "record times after end s: first", covs[0], "last", covs.at(-1));
for (const r of rs.filter(r=>r.cov===null)) console.log("  missing", r.p, r.outcome, Math.round(r.d), "ms; stored", (r.t-t0)/1000, "s; other runs at key", r.other);
const later = s.prepare("select id, started_at, ended_at, end_state, json_array_length(test_files) nf from runs where worktree_id=? and started_at > ? order by started_at limit 4").all(run.worktree_id, run.started_at);
for (const u of later) console.log("  next run", u.id.slice(0,8), (u.started_at-t0)/1000, (u.ended_at-t0)/1000, u.end_state, u.nf);
console.log("revisions near:", s.prepare("select number, created_at, trigger from revisions where worktree_id=? and abs(created_at-?) < 600000").all(run.worktree_id, t0).map(r=>[r.number,(r.created_at-t0)/1000,r.trigger]));
