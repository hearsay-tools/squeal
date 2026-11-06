// 011-300 probe (throwaway): how many recorded seconds one daemon finishes per wall minute.
// Usage: node rate.cjs <store copy> <fileruns.jsonl>
// (1) completed `run-all` checkpoints in the store: their runs' recorded seconds over the checkpoint's wall time.
// (2) baselines that ran at least 1,000 recorded s: recorded seconds over the span from their first run's start to
// their last run's end (busy span; gaps between runs count, so this is a lower bound of the busy rate).
const { DatabaseSync } = require("node:sqlite");
const fs = require("fs");
const [, , storePath, frPath] = process.argv;
const db = new DatabaseSync(storePath, { readOnly: true });
const L = fs.readFileSync(frPath, "utf8").trim().split("\n").map((l) => JSON.parse(l));
const byCp = new Map();
for (const x of L) if (x.cp) { const v = byCp.get(x.cp) ?? { sec: 0, a: Infinity, b: 0, kind: x.kind }; v.sec += x.sec; v.a = Math.min(v.a, x.rs); v.b = Math.max(v.b, x.re ?? x.rs); byCp.set(x.cp, v); }
for (const c of db.prepare("select * from checkpoints where kind = 'run-all' and completed_at is not null order by started_at desc limit 10").all()) {
  const runs = db.prepare("select log_dir from runs where checkpoint_id = ?").all(c.id);
  let sec = 0;
  for (const r of runs) { try { for (const d of JSON.parse(fs.readFileSync(r.log_dir + "/report.json", "utf8")).report.fileDurations ?? []) sec += d.durationMs / 1000; } catch {} }
  const min = (c.completed_at - c.started_at) / 60000;
  console.log(`run-all ${new Date(c.started_at).toISOString()} ${c.end_state} ${Math.round(sec)} s in ${min.toFixed(1)} min: ${(sec / min).toFixed(0)} s/min`);
}
const rates = [];
for (const [id, v] of byCp) if (v.sec >= 1000 && v.kind !== "run-all") rates.push(v.sec / ((v.b - v.a) / 60000));
rates.sort((a, b) => a - b);
const q = (p) => rates[Math.floor(p * (rates.length - 1))]?.toFixed(0);
console.log(`baselines with >= 1000 s: n ${rates.length}, s per wall min p10 ${q(0.1)} p50 ${q(0.5)} p90 ${q(0.9)}`);
