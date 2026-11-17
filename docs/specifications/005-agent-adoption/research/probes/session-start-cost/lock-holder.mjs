// Throwaway. Holds a store copy's write lock as a starting daemon's long write would:
// BEGIN IMMEDIATE, prints "locked", holds <ms> (sleeping, no CPU), COMMIT, exits.
// Usage: node lock-holder.mjs <copy.sqlite> <ms>
import { DatabaseSync } from "node:sqlite";
const [path, ms] = process.argv.slice(2);
const db = new DatabaseSync(path);
db.exec("PRAGMA busy_timeout = 10000");
db.exec("BEGIN IMMEDIATE");
db.exec("CREATE TABLE IF NOT EXISTS probe_lock (x)");
process.stdout.write("locked\n");
Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Number(ms));
db.exec("ROLLBACK");
db.close();
