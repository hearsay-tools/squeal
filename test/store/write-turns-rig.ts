import type { DatabaseSync } from "node:sqlite";
import { Worker } from "node:worker_threads";

/*
 * Row 011-350 (#220): a holder-and-waiter rig on a scratch store, after the
 * probe `docs/specifications/020-quality-gate/research/probes/issue-220/starve.mjs`.
 * The waiter is another thread with its own connection: it writes one meta
 * row per try, each try waiting at most `sliceMs` for the lock (the keeper's
 * 250 ms busy slice), then backs off 0, 100, 250 ms as `busyBackoffMs` does;
 * after a landing it rests 20 ms, as the keeper does for its next file.
 */

/** The waiter's code, run by the worker thread as CommonJS. */
const WAITER = `
const { workerData, parentPort } = require("node:worker_threads");
const { DatabaseSync } = require("node:sqlite");
const { file, shared, sliceMs } = workerData;
const flags = new Int32Array(shared);
const nap = new Int32Array(new SharedArrayBuffer(4));
const BACKOFF = [0, 100, 250];
const db = new DatabaseSync(file);
db.exec("PRAGMA busy_timeout = " + sliceMs);
let streak = 0;
parentPort.postMessage("ready");
while (Atomics.load(flags, 0) === 0) {
  try {
    db.exec("BEGIN IMMEDIATE");
    db.exec("INSERT INTO meta (key, value) VALUES ('waiter', 'x') " +
      "ON CONFLICT (key) DO UPDATE SET value = excluded.value");
    db.exec("COMMIT");
    Atomics.add(flags, 1, 1);
    streak = 0;
    Atomics.wait(nap, 0, 0, 20);
  } catch (error) {
    if (db.isTransaction) db.exec("ROLLBACK");
    if (!/busy|locked/.test(String(error && error.message))) throw error;
    Atomics.wait(nap, 0, 0, BACKOFF[Math.min(streak++, 2)]);
  }
}
db.close();
`;

export interface Waiter {
  /** The writes the waiter landed so far. */
  landed(): number;
  stop(): Promise<void>;
}

/** Starts a waiter on the store file `file`; resolves once it has opened it. */
export async function startWaiter(file: string, sliceMs = 250): Promise<Waiter> {
  const shared = new SharedArrayBuffer(8);
  const flags = new Int32Array(shared);
  const worker = new Worker(WAITER, { eval: true, workerData: { file, shared, sliceMs } });
  const failed = new Promise<never>((_, reject) => worker.once("error", reject));
  await Promise.race([new Promise((ready) => worker.once("message", ready)), failed]);
  return {
    landed: () => Atomics.load(flags, 1),
    stop: async () => {
      Atomics.store(flags, 0, 1);
      await Promise.race([new Promise((exited) => worker.once("exit", exited)), failed]);
    },
  };
}

/** The waiter's landings at the first and at the last hold, and how many holds ran. */
export interface Holds {
  first: number;
  last: number;
  count: number;
}

/**
 * Makes every `every`th row `event` writes to `table` on `db`'s connection
 * hold the write lock `ms` more, before its transaction commits, as a batch
 * of a large store takes long: a TEMP trigger, which only this connection
 * sees, so the store's schema stays as it is. Each hold reads the waiter's
 * landings while the lock is held, so `last - first` are the landings
 * between the first and the last hold: in the gaps between the holder's
 * transactions.
 */
export function holdEvery(
  db: DatabaseSync,
  event: "INSERT" | "DELETE",
  table: string,
  every: number,
  ms: number,
  landed: () => number,
): Holds {
  const holds: Holds = { first: -1, last: -1, count: 0 };
  const nap = new Int32Array(new SharedArrayBuffer(4));
  let rows = 0;
  db.function("turns_hold", () => {
    if (++rows % every !== 0) return null;
    Atomics.wait(nap, 0, 0, ms);
    const now = landed();
    if (holds.count === 0) holds.first = now;
    holds.last = now;
    holds.count++;
    return null;
  });
  db.exec(
    `CREATE TEMP TRIGGER turns_hold AFTER ${event} ON main.${table}
     BEGIN SELECT turns_hold(); END`,
  );
  return holds;
}
