import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
const db = new DatabaseSync(process.argv[2], { readOnly: true });
const since = Number(process.argv[3] ?? 0);
for (const r of db.prepare("select id, started_at, ended_at, end_state, json_array_length(test_files) n, checkpoint_id, log_dir from runs where started_at >= ? order by started_at").all(since)) {
  let rep = {};
  try { rep = JSON.parse(readFileSync(r.log_dir + "/report.json", "utf8")).report; } catch {}
  console.log(new Date(r.started_at).toISOString().slice(11, 23), r.ended_at ? ((r.ended_at - r.started_at) / 1000).toFixed(1) + "s" : "running", r.end_state, "files", r.n, "done", rep.completedFiles?.length, "cp", r.checkpoint_id?.slice(0, 8) ?? "-", "runMs", rep.durationMs, rep.failure ? String(rep.failure).slice(0, 80) : "");
}
