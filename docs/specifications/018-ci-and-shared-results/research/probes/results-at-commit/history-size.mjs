// Throwaway (results-at-commit, question 3). Size of a per-commit key history
// in SQLite, in a scratch database under <dir> (never a real store):
//   full  : one row per (commit, test file): commit id, file id, 32-byte key
//   delta : only the rows whose key differs from the previous commit's,
//           at a given change rate
// and, for comparison, today's test_file_keys layout (text ids and keys,
// two indexes) for the same rows. Keys are random; sizes depend on counts.
// Usage: node history-size.mjs <dir> <files> <commits> <change-rate>
import { randomBytes } from "node:crypto";
import { rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
const [dir, filesArg, commitsArg, rateArg] = process.argv.slice(2);
const files = Number(filesArg), commits = Number(commitsArg), rate = Number(rateArg);
function build(name, schema, rows) {
  const path = join(dir, `${name}.sqlite`);
  rmSync(path, { force: true });
  const db = new DatabaseSync(path);
  db.exec(schema);
  db.exec("BEGIN");
  rows(db);
  db.exec("COMMIT");
  db.exec("VACUUM");
  db.close();
  const bytes = statSync(path).size;
  rmSync(path);
  return bytes;
}
const compact = "CREATE TABLE h (c INTEGER, f INTEGER, k BLOB, PRIMARY KEY (c, f)) STRICT, WITHOUT ROWID;";
const full = build("full", compact, (db) => {
  const s = db.prepare("INSERT INTO h VALUES (?, ?, ?)");
  for (let c = 0; c < commits; c++) for (let f = 0; f < files; f++) s.run(c, f, randomBytes(32));
});
let deltaRows = 0;
const delta = build("delta", compact, (db) => {
  const s = db.prepare("INSERT INTO h VALUES (?, ?, ?)");
  for (let f = 0; f < files; f++) { s.run(0, f, randomBytes(32)); deltaRows++; }
  for (let c = 1; c < commits; c++) for (let f = 0; f < files; f++) if (Math.random() < rate) { s.run(c, f, randomBytes(32)); deltaRows++; }
});
const today = build("today", `CREATE TABLE k (worktree_id TEXT, project TEXT, path TEXT, key TEXT, revision INTEGER, pending TEXT,
  PRIMARY KEY (worktree_id, project, path)) STRICT; CREATE INDEX kk ON k (key);`, (db) => {
  const s = db.prepare("INSERT INTO k VALUES (?, '', ?, ?, 1, NULL)");
  for (let c = 0; c < commits; c++) {
    const commit = randomBytes(20).toString("hex");
    for (let f = 0; f < files; f++) s.run(commit, `test/some/dir/file-${f}.test.ts`, randomBytes(32).toString("hex"));
  }
});
const per = (b) => Math.round(b / commits);
console.log(JSON.stringify({ files, commits, rate, fullBytesPerCommit: per(full), deltaBytesPerCommit: per(delta), deltaRows, todayLayoutBytesPerCommit: per(today) }));
