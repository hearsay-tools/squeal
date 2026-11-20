// q4runs.mjs <label> <n>: per copy, its runs after the edit (s after edit, files, width from vitest.log, sum of file s)
import { DatabaseSync } from "node:sqlite"; import { existsSync, readFileSync } from "node:fs"; import { join } from "node:path";
const [label, n] = process.argv.slice(2); const OUT = process.env.OUT, P = process.env.P;
const t0 = +readFileSync(join(OUT, `${label}.t0`), "utf8"), t1 = +readFileSync(join(OUT, `${label}.t1`), "utf8");
const e0 = +readFileSync(join(OUT, `${label}.edits.tsv`), "utf8").split("\t")[0];
const out = [];
for (let i = 1; i <= +n; i++) {
  const db = new DatabaseSync(join(P, `q4-${i}`, ".git/squeal/store.sqlite"), { readOnly: true });
  for (const r of db.prepare("select * from runs where started_at>=? and started_at<=? order by started_at").all(t0, t1)) {
    const rep = join(r.log_dir, "report.json"); const log = join(r.log_dir, "vitest.log");
    const fd = existsSync(rep) ? JSON.parse(readFileSync(rep, "utf8")).report.fileDurations ?? [] : [];
    const m = existsSync(log) ? /maxWorkers\D{0,40}(\d+)/.exec(readFileSync(log, "utf8")) : null;
    out.push({ copy: i, lane: existsSync(log) ? "vitest" : "node", start: +((r.started_at - e0) / 1000).toFixed(1), end: +((r.ended_at - e0) / 1000).toFixed(1), files: JSON.parse(r.test_files).length, sumS: +(fd.reduce((a, d) => a + d.durationMs, 0) / 1000).toFixed(1), width: m ? +m[1] : null });
  }
}
console.log(JSON.stringify(out));
