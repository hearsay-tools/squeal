// gh-62's file in cezar's store: the file-level row, the sum of its checks, the module duration and the run wall.
import { DatabaseSync } from "node:sqlite";
import { readFileSync, existsSync } from "node:fs";
const db = new DatabaseSync(process.env.STORE ?? "/tmp/r381/cezar-store.sqlite", { readOnly: true });
const runs = db.prepare("select id, test_files, log_dir, started_at s, ended_at e, end_state from runs where test_files like '%harness-codex-parity.test.ts%' and ended_at is not null order by started_at").all();
const sum = db.prepare("select sum(r.duration_ms) ms, sum(case when c.kind='file' then r.duration_ms else 0 end) f, count(*) n from results r join checks c on c.id=r.check_id where r.run_id=? and c.test_path like '%harness-codex-parity.test.ts'");
for (const r of runs) {
  const n = JSON.parse(r.test_files).length;
  let m = null;
  const p = `${r.log_dir}/report.json`;
  if (existsSync(p)) { const rep = JSON.parse(readFileSync(p, "utf8")).report; m = rep.fileDurations?.find((d) => d.testFile.path.endsWith("harness-codex-parity.test.ts"))?.durationMs ?? null; }
  const s = sum.get(r.id);
  console.log(new Date(r.s).toISOString().slice(5, 19), `files ${n}`, r.end_state, `wall ${((r.e - r.s) / 1000).toFixed(1)}`, `module ${m === null ? "-" : (m / 1000).toFixed(1)}`, `checks ${s.n ? (s.ms / 1000).toFixed(1) : "-"}`, `file row ${s.n ? (s.f / 1000).toFixed(1) : "-"}`);
}
