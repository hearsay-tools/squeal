import { DatabaseSync } from "node:sqlite"; import { readFileSync, existsSync } from "node:fs";
const db = new DatabaseSync("stores/squeal/store.sqlite", { readOnly: true }); const copyAt = 1792770082798, since = copyAt - 72 * 3600_000;
const live = new Map(db.prepare("SELECT id, registered_at FROM worktrees").all().map((w) => [w.id, w]));
const cks = db.prepare("SELECT * FROM checkpoints WHERE kind='baseline' ORDER BY started_at").all();
const first = new Map(); for (const c of cks) if (!first.has(c.worktree_id)) first.set(c.worktree_id, c.id);
const starts = new Map(); for (const r of db.prepare("SELECT worktree_id w, number FROM revisions WHERE trigger='start' ORDER BY number").all()) (starts.get(r.w) ?? starts.set(r.w, []).get(r.w)).push(r.number);
const t = {};
for (const run of db.prepare("SELECT r.*, c.kind, c.worktree_id cw, c.revision crev, c.id cid FROM runs r JOIN checkpoints c ON c.id = r.checkpoint_id WHERE c.kind='baseline' AND r.started_at >= ?").all(since)) {
  const p = "runs/squeal/" + run.log_dir.split("/").pop() + "/report.json"; let s = 0;
  if (existsSync(p)) try { s = (JSON.parse(readFileSync(p, "utf8")).report.fileDurations ?? []).reduce((a, d) => a + d.durationMs / 1000, 0); } catch {}
  const w = run.cw, L = live.has(w); const st = starts.get(w) ?? [];
  const firstStart = st.filter((n) => n <= run.crev).length <= 1;
  const k = `${L ? "live" : "removed"}: ${first.get(w) === run.cid ? "first baseline checkpoint" : firstStart ? "later baseline checkpoint, before the second daemon start" : "baseline of a later daemon start"}`;
  t[k] = (t[k] ?? 0) + s;
}
for (const [k, s] of Object.entries(t).sort()) console.log(Math.round(s), k);
