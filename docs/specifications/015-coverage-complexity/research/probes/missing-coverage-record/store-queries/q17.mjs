import { DatabaseSync } from "node:sqlite";
import { readFileSync, existsSync } from "node:fs";
const dir = "/home/agent/projects/squeal/.git/squeal/";
const s = new DatabaseSync(dir + "store.sqlite", { readOnly: true });
s.exec(`attach database 'file:${dir}code.sqlite?mode=ro' as c`);
const since = Date.parse(process.argv[2]);
const PAUSE = Number(process.argv[3] ?? 5000);
const runs = s.prepare(`select id, worktree_id w, ended_at from runs where end_state='completed' and ended_at > ?`).all(since);
const res = s.prepare(`select k.test_path p, r.outcome o, (select recorded_at from c.coverage v where v.result_key=r.key) cov from results r join checks k on k.id=r.check_id where r.run_id=? and k.kind='file'`);
const between = s.prepare("select recorded_at t from c.coverage where recorded_at between ? and ? order by recorded_at");
const longestPause = (a, b) => {
  const ts = [a, ...between.all(a, b).map(r => r.t), b];
  let m = 0; for (let i = 1; i < ts.length; i++) m = Math.max(m, ts[i] - ts[i-1]); return m;
};
let missing = 0, inPause = 0, noLog = 0, unbounded = 0;
for (const u of runs) {
  const rs = res.all(u.id);
  if (!rs.some(r => r.cov !== null)) continue;
  const miss = rs.filter(r => r.cov === null && r.o === "pass");
  if (miss.length === 0) continue;
  const log = `${dir}runs/${u.id}/vitest.log`;
  if (!existsSync(log)) { noLog += miss.length; missing += miss.length; continue; }
  const order = [...readFileSync(log, "utf8").matchAll(/^MODULE \w+ (.+)$/gm)].map(m => m[1]);
  const by = new Map(rs.map(r => [r.p, r]));
  const seq = order.map(p => by.get(p)).filter(Boolean);
  for (let i = 0; i < seq.length; i++) {
    const r = seq[i]; if (r.cov !== null || r.o !== "pass") continue;
    missing++;
    let prev = u.ended_at; for (let j = i - 1; j >= 0; j--) if (seq[j].cov !== null) { prev = seq[j].cov; break; }
    let next = null; for (let j = i + 1; j < seq.length; j++) if (seq[j].cov !== null) { next = seq[j].cov; break; }
    if (next === null || next < prev) { next = prev + 60000; unbounded++; }
    if (longestPause(prev, next) >= PAUSE) inPause++;
  }
}
console.log({ PAUSE, missing, explainedByHostWidePause: inPause, share: (100 * inPause / missing).toFixed(1) + "%", noLog, windowGuessedForTailOrDisorder: unbounded });
