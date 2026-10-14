/*
 * Task 001-362 probe: `test/daemon/long-writer.ts` with its 250 ms retry
 * made `pollMs`, so the lock stays free between two writers only as long as
 * that retry. Run as `node --import tsx poll-writer.ts <store> <holdMs> <restMs> <pollMs>`.
 */
import { DatabaseSync } from "node:sqlite";
import { setTimeout as sleep } from "node:timers/promises";

const [database, hold, rest, poll] = process.argv.slice(2);
if (database === undefined || hold === undefined || rest === undefined || poll === undefined) {
  throw new Error("usage: poll-writer.ts <store> <holdMs> <restMs> <pollMs>");
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
    await sleep(Number(poll));
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
