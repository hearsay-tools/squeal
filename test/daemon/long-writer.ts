/*
 * A busy daemon's writes as task 001-161 found them, for `busy-store.test.ts`:
 * the store's write lock held `holdMs` at a time, as recording a 250-file
 * tier held it 6 to 67 s before the fix. Between holds it rests `restMs` and
 * then retries every 250 ms without waiting, so a waiter in SQLite's busy
 * handler can take the lock in the gap. Run as
 * `node --import tsx long-writer.ts <store> <holdMs> <restMs>`; prints
 * `holding` at its first hold; stops on SIGTERM.
 */
import { DatabaseSync } from "node:sqlite";
import { setTimeout as sleep } from "node:timers/promises";

const [database, hold, rest] = process.argv.slice(2);
if (database === undefined || hold === undefined || rest === undefined) {
  throw new Error("usage: long-writer.ts <store> <holdMs> <restMs>");
}
const db = new DatabaseSync(database);
db.exec("PRAGMA busy_timeout = 0");
let stopping = false;
process.on("SIGTERM", () => {
  stopping = true;
});
let first = true;
while (!stopping) {
  try {
    db.exec("BEGIN IMMEDIATE");
  } catch {
    await sleep(250);
    continue;
  }
  db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('long-writer', ?)").run(
    String(process.pid),
  );
  if (first) process.stdout.write("holding\n");
  first = false;
  await sleep(Number(hold));
  db.exec("COMMIT");
  await sleep(Number(rest));
}
db.close();
