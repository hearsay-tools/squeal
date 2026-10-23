/*
 * Child process that holds the code store's write lock for 500 ms, so an
 * open in the test process meets it.
 *
 *   holder <path> rollback   a file in rollback mode with one table: the
 *                            open meets the lock at its switch into WAL
 *   holder <path> migrate    a file in WAL, migrated inside the held
 *                            transaction: the open meets it at its migration
 *
 * Prints `held` once the lock is taken and exits 0 after it commits.
 */
import { DatabaseSync } from "node:sqlite";
import { CODE_MIGRATIONS, CODE_SCHEMA_VERSION } from "../../../src/core/code/store/schema.js";

const [path, mode] = process.argv.slice(2);
if (!path || (mode !== "rollback" && mode !== "migrate")) {
  throw new Error("usage: holder <path> rollback|migrate");
}
const db = new DatabaseSync(path);
if (mode === "rollback") {
  db.exec("CREATE TABLE holder (x)");
  db.exec("BEGIN IMMEDIATE");
  db.exec("INSERT INTO holder VALUES (1)");
} else {
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("BEGIN IMMEDIATE");
  for (const step of CODE_MIGRATIONS) step(db);
  db.exec(`PRAGMA user_version = ${CODE_SCHEMA_VERSION}`);
}
console.log("held");
setTimeout(() => {
  db.exec("COMMIT");
  db.close();
}, 500);
