// Every run of one worktree since a time (read only): start, end, end state, run id and
// its test files (or their count). Usage: node runs.mjs <store.sqlite> <worktree-id> <since iso>
import { DatabaseSync } from "node:sqlite";

const [file, wt, since] = process.argv.slice(2);
const db = new DatabaseSync(file, { readOnly: true });
const hm = (ms) => (ms == null ? "-" : new Date(ms).toISOString().slice(11, 23));
for (const r of db.prepare("select * from runs where worktree_id = ? and started_at > ? order by started_at").all(wt, Date.parse(since))) {
  const files = JSON.parse(r.test_files).map((f) => f.path ?? f);
  console.log(hm(r.started_at), hm(r.ended_at), r.end_state, r.id.slice(0, 8), files.length <= 4 ? files.join(" ") : `${files.length} files`);
}
