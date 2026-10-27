import { DatabaseSync } from "node:sqlite";
import { readFileSync, existsSync } from "node:fs";
const dir = "/home/agent/projects/squeal/.git/squeal/";
const s = new DatabaseSync(dir + "store.sqlite", { readOnly: true });
s.exec(`attach database 'file:${dir}code.sqlite?mode=ro' as c`);
const since = Date.parse(process.argv[2]);
const runs = s.prepare(`select id, worktree_id w, started_at, ended_at, json_array_length(test_files) nf from runs where end_state='completed' and ended_at > ? order by ended_at`).all(since);
const res = s.prepare(`select k.test_path p, r.outcome, (select recorded_at from c.coverage v where v.result_key=r.key) cov from results r join checks k on k.id=r.check_id where r.run_id=? and k.kind='file'`);
const nextRun = s.prepare(`select min(started_at) t from runs where worktree_id=? and started_at > ?`);
const lastRun = s.prepare(`select max(ended_at) t from runs where worktree_id=?`);
const wt = s.prepare(`select count(*) n from worktrees where id=?`);
const shapes = {}; const ex = {};
for (const u of runs) {
  const rs = res.all(u.id);
  const missing = rs.filter(r => r.cov === null && r.outcome === 'pass');
  if (!rs.some(r => r.cov !== null) && rs.length > 1) continue; // coverage not known on
  if (missing.length === 0) continue;
  const log = `${dir}runs/${u.id}/vitest.log`;
  let shape = "no log";
  if (existsSync(log)) {
    const order = [...readFileSync(log, "utf8").matchAll(/^MODULE \w+ (.+)$/gm)].map(m => m[1]);
    const cov = new Map(rs.map(r => [r.p, r.cov]));
    const pos = order.map((p, i) => [i, cov.get(p)]).filter(([, c]) => c === null).map(([i]) => i);
    const firstMiss = Math.min(...pos), lastMiss = Math.max(...pos);
    const contiguous = lastMiss - firstMiss + 1 === pos.length;
    const tail = lastMiss === order.length - 1 && contiguous;
    const all = pos.length === rs.length;
    shape = all ? "every file" : tail ? "tail block" : contiguous ? "inner block" : "scattered";
  }
  const alive = wt.get(u.w).n > 0;
  const isLast = lastRun.get(u.w).t === u.ended_at;
  const nr = nextRun.get(u.w, u.started_at).t;
  const gap = nr === null ? "none" : (nr - u.ended_at) < 3000 ? "<3s" : "later";
  const key = `${shape} | ${isLast ? "worktree's last run" : "next run " + gap} | ${alive ? "alive" : "gone"}`;
  shapes[key] = (shapes[key] ?? { runs: 0, files: 0 }); shapes[key].runs++; shapes[key].files += missing.length;
  (ex[key] ??= []).push(`${u.id.slice(0,8)} ${u.w.slice(0,8)} nf=${rs.length} miss=${missing.length}`);
}
for (const [k, v] of Object.entries(shapes).sort((a,b)=>b[1].files-a[1].files)) console.log(v.runs, "runs", v.files, "files:", k, "e.g.", ex[k].slice(0,3).join("; "));
