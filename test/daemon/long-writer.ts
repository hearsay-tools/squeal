/*
 * A busy daemon's writes as task 001-161 found them, for `busy-store.test.ts`:
 * the store's write lock held `holdMs` at a time, as recording a 250-file
 * tier held it 6 to 67 s before the fix. Writers take turns on one schedule
 * from `epochMs`: slot s, `holdMs + restMs` long from `epochMs + s * (holdMs
 * + restMs)`, is writer `s % writers`'s, held to `holdMs` into it, so the lock
 * is free `restMs` between any two holds and a waiter in SQLite's busy
 * handler, which tries again every 100 ms, takes it there. Task 001-362:
 * writers that each retried every 250 ms left it free only as long as their
 * race, 5 to 20 ms for minutes, and a daemon start waited out its 120 s. A
 * hold waits behind the waiter's write. Run as `node --import tsx
 * long-writer.ts <store> <holdMs> <restMs> <turn> <writers> <epochMs>`;
 * prints `holding` at its first hold and `freed <epoch ms>` as each commit
 * returns; stops on SIGTERM.
 */
import { DatabaseSync } from "node:sqlite";
import { setTimeout as sleep } from "node:timers/promises";

const [database, ...numbers] = process.argv.slice(2);
const [hold, rest, turn, writers, epoch] = numbers.map(Number);
if (
  database === undefined ||
  hold === undefined ||
  rest === undefined ||
  turn === undefined ||
  writers === undefined ||
  epoch === undefined
) {
  throw new Error("usage: long-writer.ts <store> <holdMs> <restMs> <turn> <writers> <epochMs>");
}
const db = new DatabaseSync(database);
db.exec("PRAGMA busy_timeout = 60000");
let stopping = false;
// Task 011-122: SIGTERM ends a sleep at once, a long rest's too, where it waited out the 60 s grace.
const stop = new AbortController();
process.on("SIGTERM", () => {
  stopping = true;
  stop.abort();
});
const wait = (ms: number) => sleep(ms, undefined, { signal: stop.signal }).catch(() => {});
for (let slot = turn; !stopping; slot += writers) {
  const start = epoch + slot * (hold + rest);
  await wait(Math.max(0, start - Date.now()));
  if (stopping) break;
  db.exec("BEGIN IMMEDIATE");
  db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('long-writer', ?)").run(
    String(process.pid),
  );
  if (slot === turn) process.stdout.write("holding\n");
  await wait(Math.max(0, start + hold - Date.now()));
  db.exec("COMMIT");
  // When the lock really freed: a late timer or a slow sync frees it after its slot's end.
  process.stdout.write(`freed ${Date.now()}\n`);
}
db.close();
