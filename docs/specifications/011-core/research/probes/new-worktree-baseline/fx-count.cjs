// 011-299 probe (throwaway): baseline checkpoints of the fixture's store copy: listed files, files run, end state.
const { DatabaseSync } = require("node:sqlite");
const db = new DatabaseSync(process.argv[2], { readOnly: true });
for (const c of db.prepare("select * from checkpoints order by started_at").all()) {
  const runs = db.prepare("select test_files from runs where checkpoint_id = ?").all(c.id);
  const ran = runs.flatMap((r) => JSON.parse(r.test_files).map((f) => f.path));
  console.log(c.worktree_id.slice(0, 6), c.kind, "rev", c.revision, c.end_state, "listed", JSON.parse(c.test_files).length, "ran", ran.length, ran.map((p) => p.replace(/^test\/|\.test\.ts$/g, "")).join(","));
}
const keys = db.prepare("select worktree_id, path, key from test_file_keys order by worktree_id, path").all();
console.log("keys", keys.map((k) => k.worktree_id.slice(0, 6) + ":" + k.path.replace(/^test\/|\.test\.ts$/g, "") + "=" + (k.key ?? "null").slice(0, 6)).join(" "));
