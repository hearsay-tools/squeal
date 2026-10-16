// Throwaway probe for issue 7. Holds one SQLite lock on a scratch store for
// <holdMs>, printing when it holds and when it releases (epoch ms).
// Usage: node hold.mjs <store.sqlite> <mode> <holdMs>
//   immediate          BEGIN IMMEDIATE plus one write: WAL's write lock (D8's writers)
//   exclusive          BEGIN EXCLUSIVE plus one write: in WAL the same lock as immediate
//   exclusive-locking  locking_mode=EXCLUSIVE, BEGIN EXCLUSIVE plus one write: the
//                      file's EXCLUSIVE lock, which WAL readers cannot share
//   read               BEGIN plus one read: a long reader
import { DatabaseSync } from "node:sqlite";
const [db, mode, holdMs] = process.argv.slice(2);
const conn = new DatabaseSync(db);
conn.exec("PRAGMA busy_timeout = 30000");
if (mode === "exclusive-locking") conn.exec("PRAGMA locking_mode = EXCLUSIVE");
const begin = { immediate: "BEGIN IMMEDIATE", exclusive: "BEGIN EXCLUSIVE",
  "exclusive-locking": "BEGIN EXCLUSIVE", read: "BEGIN" }[mode];
if (begin === undefined) throw new Error(`unknown mode ${mode}`);
conn.exec(begin);
if (mode === "read") conn.prepare("SELECT count(*) FROM sqlite_master").get();
else conn.exec("CREATE TABLE IF NOT EXISTS probe_issue7 (x); INSERT INTO probe_issue7 VALUES (1)");
console.log(`held ${mode} ${Date.now()}`);
setTimeout(() => {
  conn.exec("ROLLBACK");
  conn.close();
  console.log(`released ${mode} ${Date.now()}`);
}, Number(holdMs));
