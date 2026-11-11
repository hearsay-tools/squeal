import { Worker } from "node:worker_threads";
import { onTestFinished } from "vitest";

/*
 * Spec 021 D2 (row 021-08): a second connection that takes the store's
 * write lock at an exact point of the daemon's own synchronous code, and
 * releases it on its own clock. Another thread holds it, so a daemon whose
 * event loop waits inside SQLite's busy handler still sees it released.
 */

/** Waits for a go, then holds the store's write lock `holdMs` on its own event loop. */
const HOLDER = `
const { workerData } = require("node:worker_threads");
const { DatabaseSync } = require("node:sqlite");
const flags = new Int32Array(workerData.flags);
Atomics.wait(flags, 0, 0);
const db = new DatabaseSync(workerData.database);
db.exec("BEGIN IMMEDIATE");
Atomics.store(flags, 1, 1);
Atomics.notify(flags, 1);
setTimeout(() => {
  db.exec("ROLLBACK");
  db.close();
  Atomics.store(flags, 2, 1);
}, workerData.holdMs);
`;

export interface ThreadLockHolder {
  /** Holds the lock before it returns, as a write about to begin needs it. */
  take(): void;
  readonly taken: boolean;
  readonly released: boolean;
}

/** A holder of `database`'s write lock for `holdMs` once taken; ended with the test. */
export function threadLockHolder(database: string, holdMs: number): ThreadLockHolder {
  const flags = new Int32Array(new SharedArrayBuffer(12));
  const worker = new Worker(HOLDER, {
    eval: true,
    workerData: { database, holdMs, flags: flags.buffer },
  });
  onTestFinished(async () => {
    await worker.terminate();
  });
  return {
    take() {
      Atomics.store(flags, 0, 1);
      Atomics.notify(flags, 0);
      Atomics.wait(flags, 1, 0, 5_000);
    },
    get taken() {
      return Atomics.load(flags, 1) === 1;
    },
    get released() {
      return Atomics.load(flags, 2) === 1;
    },
  };
}

/** The stack where it is called, all of it: async frames included. */
export function fullStack(): string {
  const limit = Error.stackTraceLimit;
  Error.stackTraceLimit = 80;
  try {
    return new Error().stack ?? "";
  } finally {
    Error.stackTraceLimit = limit;
  }
}
