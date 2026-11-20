// filedur.mjs <label> <n>: per copy, each Vitest file its runs after the edit
// finished, one line each: copy, run start (s after the edit), the run's
// files, the file's path and its duration in ms (report.json fileDurations).
// Row 011-423: compares per-file times across runs and run positions.
import { DatabaseSync } from "node:sqlite"; import { existsSync, readFileSync } from "node:fs"; import { join } from "node:path";
const [label, n] = process.argv.slice(2); const OUT = process.env.OUT, P = process.env.P;
const t0 = +readFileSync(join(OUT, `${label}.t0`), "utf8"), t1 = +readFileSync(join(OUT, `${label}.t1`), "utf8");
const e0 = +readFileSync(join(OUT, `${label}.edits.tsv`), "utf8").split("\t")[0];
const lines = ["copy\tstart_s\tfiles\tpath\tms"];
for (let i = 1; i <= +n; i++) {
  const db = new DatabaseSync(join(P, `q4-${i}`, ".git/squeal/store.sqlite"), { readOnly: true });
  for (const r of db.prepare("select * from runs where started_at>=? and started_at<=? order by started_at").all(t0, t1)) {
    const rep = join(r.log_dir, "report.json");
    if (!existsSync(rep)) continue;
    const fd = JSON.parse(readFileSync(rep, "utf8")).report.fileDurations ?? [];
    const files = JSON.parse(r.test_files).length;
    for (const d of fd) lines.push(`${i}\t${((r.started_at - e0) / 1000).toFixed(1)}\t${files}\t${d.testFile?.project}:${d.testFile?.path}\t${d.durationMs}`);
  }
}
console.log(lines.join("\n"));
