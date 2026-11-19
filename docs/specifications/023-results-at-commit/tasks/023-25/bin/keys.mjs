// Row 023-25 probe: the daemon's key for one test file and the keys its results are stored at.
import { DatabaseSync } from "node:sqlite";
const [store, path] = process.argv.slice(2);
const db = new DatabaseSync(store, { readOnly: true });
console.log("daemon keys", db.prepare("select worktree_id, project, key, revision from test_file_keys where path = ?").all(path));
const cols = db.prepare("pragma table_info(checks)").all().map((c) => c.name);
const pathCol = cols.includes("test_path") ? "test_path" : cols.find((c) => c.includes("path"));
console.log("result keys", db.prepare(`select r.key, r.outcome, r.revision, r.worktree_id, count(*) n from results r join checks c on c.id = r.check_id where c.${pathCol} = ? group by r.key, r.outcome`).all(path));
