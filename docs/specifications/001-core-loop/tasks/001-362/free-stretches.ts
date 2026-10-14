/*
 * Task 001-362 probe: how long `test/daemon/long-writer.ts` leaves the write
 * lock free. Runs the busy-store test's two writers on their shared schedule
 * and an observer that takes and at once releases the lock every 5 ms
 * without waiting; samples less than 50 ms apart are one free stretch, and
 * the stretches between `<holds>` holds print. Run as
 * `node --import tsx free-stretches.ts <dir> <holdMs> <restMs> <holds>`.
 * Touches only `<dir>`.
 */
import { spawn } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const [dir, hold, rest, holds] = process.argv.slice(2);
if (dir === undefined || hold === undefined || rest === undefined || holds === undefined) {
  throw new Error("usage: free-stretches.ts <dir> <holdMs> <restMs> <holds>");
}
const database = join(dir, "free.sqlite");
const db = new DatabaseSync(database);
db.exec("PRAGMA journal_mode = WAL; CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)");
db.exec("PRAGMA busy_timeout = 0");
// `PROBE_WRITER` names another writer, such as the one before task 001-362, which ignores the schedule.
const writer =
  process.env.PROBE_WRITER ?? join(import.meta.dirname, "../../../../../test/daemon/long-writer.ts");
const epoch = Date.now() + 2_000;
const writers = [0, 1].map((turn) =>
  spawn(
    process.execPath,
    [...process.execArgv, writer, database, hold, rest, String(turn), "2", String(epoch)],
    { stdio: ["ignore", "ignore", "inherit"] },
  ),
);
const end = epoch + Number(holds) * (Number(hold) + Number(rest));
await sleep(epoch - Date.now() + Number(hold) / 2);
const free: number[] = [];
while (Date.now() < end) {
  try {
    db.exec("BEGIN IMMEDIATE");
    db.exec("COMMIT");
    free.push(Date.now());
  } catch {
    // Held.
  }
  await sleep(5);
}
for (const w of writers) w.kill("SIGKILL");
const stretches: number[] = [];
let first = free[0];
for (let i = 1; i <= free.length; i++) {
  const [before, at] = [free[i - 1] as number, free[i]];
  if (at === undefined || at - before >= 50) {
    stretches.push(before - (first as number));
    first = at;
  }
}
console.log(`free stretches (ms): ${stretches.join(" ")}`);
console.log(`${stretches.length} stretches; shortest ${Math.min(...stretches)} ms, longest ${Math.max(...stretches)} ms`);
