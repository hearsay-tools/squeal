import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync(process.env.STORE ?? "/tmp/r381/cezar-store.sqlite", { readOnly: true });
const wt = process.argv[2];
const iso = (t) => t == null ? "-" : new Date(t).toISOString().slice(5, 19);
const events = [];
for (const r of db.prepare("select number, created_at, trigger, head, changes from revisions where worktree_id=? order by number").all(wt)) {
  const ch = JSON.parse(r.changes);
  events.push([r.created_at, `REV ${r.number} ${r.trigger} head=${(r.head ?? "").slice(0, 8)} changes=${ch.length} ${ch.slice(0, 3).map((c) => c.path ?? JSON.stringify(c)).join(" ")}`]);
}
for (const r of db.prepare("select id, revision, test_files, checkpoint_id, started_at, ended_at, end_state, log_dir from runs where worktree_id=? order by started_at").all(wt)) {
  const f = JSON.parse(r.test_files);
  events.push([r.started_at, `RUN ${r.id.slice(0, 8)} rev=${r.revision} n=${f.length} cp=${r.checkpoint_id ? r.checkpoint_id.slice(0, 6) : "-"} end=${r.end_state} wall=${r.ended_at ? ((r.ended_at - r.started_at) / 1000).toFixed(1) : "-"}s until ${iso(r.ended_at)} ${f.length <= 4 ? f.map((x) => x.path.split("/").pop()).join(",") : ""}`]);
}
for (const r of db.prepare("select id, revision, kind, started_at, completed_at, end_state, json_array_length(test_files) n from checkpoints where worktree_id=? order by started_at").all(wt))
  events.push([r.started_at, `CKPT ${r.id.slice(0, 6)} rev=${r.revision} ${r.kind} n=${r.n} end=${r.end_state} at ${iso(r.completed_at)}`]);
events.sort((a, b) => a[0] - b[0]);
for (const [t, s] of events) console.log(iso(t), s);
