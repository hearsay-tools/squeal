import { DatabaseSync } from "node:sqlite";
const dir = "/home/agent/projects/squeal/.git/squeal/";
const s = new DatabaseSync(dir + "store.sqlite", { readOnly: true });
const windows = process.argv.slice(2).map(Date.parse);
const firstRuns = s.prepare("select worktree_id w, min(started_at) t from runs group by worktree_id").all();
const starts = s.prepare("select id w, daemon_started_at t from worktrees").all();
for (const w of windows) {
  const near = (rows) => rows.filter(r => r.t !== null && r.t > w - 180000 && r.t < w).map(r => `${r.w.slice(0,8)}@${((r.t - w)/1000).toFixed(0)}s`);
  console.log(new Date(w).toISOString(), "first runs in 180 s before:", near(firstRuns).join(" ") || "-", "| daemon starts:", near(starts).join(" ") || "-");
}
