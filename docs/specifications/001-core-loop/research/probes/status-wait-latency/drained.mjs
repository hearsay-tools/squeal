// Exits 0 when no test file of the clone's worktree is pending; prints the count otherwise.
import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync(`${process.argv[2]}/.git/squeal/store.sqlite`, { readOnly: true });
const n = db.prepare("select count(*) n from test_file_keys where pending is not null").get().n;
const running = db.prepare("select count(*) n from runs where ended_at is null").get().n;
if (n > 0 || running > 0) { console.log(`pending ${n}, runs in flight ${running}`); process.exit(1); }
