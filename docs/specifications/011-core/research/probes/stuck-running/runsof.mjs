// node runsof.mjs <common-dir> <substring>: runs whose test_files contain the substring.
import { DatabaseSync } from "node:sqlite";
const [dir, sub] = process.argv.slice(2);
const db = new DatabaseSync(dir + "/squeal/store.sqlite", { readOnly: true });
for (const r of db.prepare("SELECT id, worktree_id w, revision, test_files f, started_at s, ended_at e, end_state st FROM runs WHERE test_files LIKE ? ORDER BY started_at").all(`%${sub}%`))
  console.log(new Date(Number(r.s)).toISOString().slice(11, 19), r.e ? new Date(Number(r.e)).toISOString().slice(11, 19) : "open", r.w.slice(0, 6), "rev" + r.revision, JSON.parse(r.f).length + "f", r.st, r.e ? Number(r.e) - Number(r.s) + "ms" : "");
