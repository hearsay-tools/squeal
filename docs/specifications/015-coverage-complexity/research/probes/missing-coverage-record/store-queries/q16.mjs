import { DatabaseSync } from "node:sqlite";
const dir = "/home/agent/projects/squeal/.git/squeal/";
const s = new DatabaseSync(dir + "store.sqlite", { readOnly: true });
s.exec(`attach database 'file:${dir}code.sqlite?mode=ro' as c`);
for (const id of process.argv.slice(2)) {
  const run = s.prepare("select * from runs where id like ?").get(id + "%");
  const t0 = run.ended_at;
  const ts = s.prepare("select recorded_at t from c.coverage where recorded_at between ? and ? order by recorded_at").all(t0 - 120000, t0 + 120000).map(r => r.t);
  // The pause in every worktree's record writes that spans the run's end.
  let before = Math.max(...ts.filter(t => t <= t0)), after = Math.min(...ts.filter(t => t > t0));
  const gaps = []; for (let i = 1; i < ts.length; i++) gaps.push(ts[i] - ts[i-1]);
  gaps.sort((a,b)=>a-b);
  console.log(id, "records by all worktrees in ±120 s:", ts.length, "| pause spanning the run end:", ((after - before)/1000).toFixed(1), "s, from", ((before - t0)/1000).toFixed(1), "to", ((after - t0)/1000).toFixed(1), "s | median gap", (gaps[gaps.length>>1]/1000).toFixed(2), "s, p99", (gaps[Math.floor(gaps.length*0.99)]/1000).toFixed(1), "s");
}
