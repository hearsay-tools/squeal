import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
const dir = "/home/agent/projects/squeal/.git/squeal/";
const s = new DatabaseSync(dir + "store.sqlite", { readOnly: true });
s.exec(`attach database 'file:${dir}code.sqlite?mode=ro' as c`);
for (const id of process.argv.slice(2)) {
  const run = s.prepare("select * from runs where id like ?").get(id + "%");
  const t0 = run.ended_at;
  const order = [...readFileSync(`${dir}runs/${run.id}/vitest.log`, "utf8").matchAll(/^MODULE \w+ (.+)$/gm)].map(m => m[1]);
  const rs = new Map(s.prepare(`select k.test_path p, r.outcome o, (select recorded_at from c.coverage v where v.result_key=r.key) cov from results r join checks k on k.id=r.check_id where r.run_id=? and k.kind='file'`).all(run.id).map(r => [r.p, r]));
  let line = "";
  let blocks = [];
  let cur = null, lastCov = null;
  order.forEach((p, i) => {
    const r = rs.get(p);
    if (r === undefined) { line += "?"; return; }
    if (r.cov === null) { line += r.o === "pass" ? "X" : "f"; if (cur === null) cur = { from: i, n: 0, before: lastCov }; cur.n++; }
    else { line += "."; if (cur !== null) { cur.after = r.cov; blocks.push(cur); cur = null; } lastCov = r.cov; }
  });
  if (cur !== null) blocks.push(cur);
  console.log(id, "files", order.length, line);
  for (const b of blocks) console.log("   block at", b.from + 1, "n", b.n, "neighbour records", b.before ? ((b.before - t0)/1000).toFixed(2) : "-", "->", b.after ? ((b.after - t0)/1000).toFixed(2) : "-", "s after end; gap", b.before && b.after ? ((b.after - b.before)/1000).toFixed(2) : "-");
}
