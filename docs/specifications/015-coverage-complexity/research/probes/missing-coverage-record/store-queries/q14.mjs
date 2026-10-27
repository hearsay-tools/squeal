import { DatabaseSync } from "node:sqlite";
const dir = "/home/agent/projects/squeal/.git/squeal/";
const s = new DatabaseSync(dir + "store.sqlite", { readOnly: true });
s.exec(`attach database 'file:${dir}code.sqlite?mode=ro' as c`);
const [id, a, b] = process.argv.slice(2);
const run = s.prepare("select * from runs where id like ?").get(id + "%");
const from = run.ended_at + Number(a) * 1000, to = run.ended_at + Number(b) * 1000;
const pad = 60000;
const q = (sql) => s.prepare(sql).all(from - pad, to + pad).map(r => r.t);
const series = {
  coverage: q("select recorded_at t from c.coverage where recorded_at between ? and ?"),
  states: q("select changed_at t from c.states where changed_at between ? and ?"),
  transitions: q("select at t from c.transitions where at between ? and ?"),
  counts: q("select counted_at t from c.counts where counted_at between ? and ?"),
  views: q("select told_at t from c.views where told_at between ? and ?"),
};
console.log(run.id.slice(0,8), "window", new Date(from).toISOString(), "->", new Date(to).toISOString(), ((to-from)/1000).toFixed(1), "s");
for (const [k, ts] of Object.entries(series)) {
  const before = ts.filter(t => t < from).length, inside = ts.filter(t => t >= from + 1500 && t <= to - 1500).length, after = ts.filter(t => t > to).length;
  console.log(`  ${k.padEnd(12)} 60 s before: ${before}  inside (1.5 s margins): ${inside}  60 s after: ${after}`);
}
