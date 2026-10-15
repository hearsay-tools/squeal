// Adds results history (old keys) until the fixture store is ~200 MB (task 001-414).
import { DatabaseSync } from "node:sqlite";
import { statSync } from "node:fs";
const file = process.argv[2];
const db = new DatabaseSync(file);
db.exec("PRAGMA busy_timeout=10000");
const size = () => { db.exec("PRAGMA wal_checkpoint(TRUNCATE)"); return statSync(file).size; };
const pad = "r".repeat(150);
for (let i = 0; i < 200 && size() < 200e6; i++) {
  db.exec(`INSERT INTO results SELECT id, 'old-key-${i}-' || id, 'pass', 5, 'src/x.test.ts', 1, 1, NULL, NULL,
    'wt-main', ${i}, 'c0ffee', 0, 'run-${i}-${pad}', ${1000 + i}, ${1000 + i} FROM checks`);
  if (i % 10 === 0) console.log(i, (statSync(file).size / 1e6).toFixed(1));
}
console.log("final MB", (size() / 1e6).toFixed(1));
