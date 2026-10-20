// Throwaway probe for issue 55 (not product code). Seeds a disposable git repo
// with a Squeal store at schema V1 (taken from src/core/store/schema.ts) and
// prints the repo path. Usage: node seed.mjs <schema.ts> <dir> <otherChecks> <files>
// One target file gets 10 checks x 35 results; <otherChecks> more checks of
// this worktree are spread over <files> other test files, 1 result each.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const [schemaTs, dir, otherArg, filesArg] = process.argv.slice(2);
const other = Number(otherArg);
const files = Number(filesArg);
const v1 = /const V1 = `([\s\S]*?)`;/.exec(readFileSync(schemaTs, "utf8"))[1];

mkdirSync(dir, { recursive: true });
execFileSync("git", ["init", "-q", dir]);
const root = realpathSync(dir);
const wt = createHash("sha256").update(root).digest("hex").slice(0, 16);
mkdirSync(join(root, ".git", "squeal", "runs"), { recursive: true });
const db = new DatabaseSync(join(root, ".git", "squeal", "store.sqlite"));
db.exec("PRAGMA journal_mode = WAL");
db.exec(v1);
db.exec("PRAGMA user_version = 1");
const now = Date.now();
db.prepare("INSERT INTO worktrees (id, root, common_dir, is_main, registered_at) VALUES (?, ?, ?, 1, ?)")
  .run(wt, root, join(root, ".git"), now);
db.prepare("INSERT INTO revisions (worktree_id, number, created_at, dirty, trigger, changes) VALUES (?, 1, ?, 0, 'start', '[]')")
  .run(wt, now);
db.prepare("INSERT INTO runs (id, worktree_id, revision, test_files, log_dir, started_at, ended_at, end_state) VALUES ('run0', ?, 1, '[]', ?, ?, ?, 'completed')")
  .run(wt, join(root, ".git", "squeal", "runs", "run0"), now, now);

const check = db.prepare("INSERT INTO checks (kind, project, test_path, full_name, templated, first_seen_at) VALUES ('test', 'p', ?, ?, 0, ?)");
const known = db.prepare("INSERT INTO known_states (worktree_id, check_id, outcome, validity, observed_at, duration_ms) VALUES (?, ?, 'pass', 'current', 1, 5)");
const fileKey = db.prepare("INSERT INTO test_file_keys (worktree_id, project, path, key, revision) VALUES (?, 'p', ?, ?, 1)");
const result = db.prepare("INSERT INTO results (check_id, key, outcome, duration_ms, worktree_id, revision, dirty, run_id, recorded_at, last_used_at) VALUES (?, ?, 'pass', 5, ?, 1, 0, 'run0', ?, ?)");

db.exec("BEGIN");
const target = "src/target.test.ts";
fileKey.run(wt, target, "key-target-34");
for (let c = 0; c < 10; c++) {
  const id = Number(check.run(target, `target > case ${c}`, now).lastInsertRowid);
  known.run(wt, id);
  for (let k = 0; k < 35; k++) result.run(id, `key-target-${k}`, wt, now - (35 - k) * 1000, now);
}
for (let f = 0; f < files; f++) fileKey.run(wt, `src/f${f}.test.ts`, `key-f${f}`);
for (let i = 0; i < other; i++) {
  const f = i % files;
  const id = Number(check.run(`src/f${f}.test.ts`, `suite > case ${i}`, now).lastInsertRowid);
  known.run(wt, id);
  result.run(id, `key-f${f}`, wt, now, now);
}
db.exec("COMMIT");
db.close();
console.log(root);
