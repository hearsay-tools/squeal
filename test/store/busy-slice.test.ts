import { DatabaseSync } from "node:sqlite";
import { Worker } from "node:worker_threads";
import { describe, expect, it } from "vitest";
import {
  BusyWaits,
  isBusy,
  setBusyTimeout,
  storePaths,
  withBusySlice,
  withBusySliceSync,
} from "../../src/core/store/index.js";
import { inspectConnection } from "../../src/core/store/open.js";
import { fakeCommonDir, open } from "./helpers.js";

/*
 * Task 001-422: a pass's and the timers' writes wait a slice of a busy store
 * instead of the connection's busy timeout, set and restored around the one
 * statement that takes the lock, so no other write's wait changes.
 */

const OWN_MS = 3_000;
const SLICE_MS = 100;

function busyStore() {
  const commonDir = fakeCommonDir();
  const store = open(commonDir);
  setBusyTimeout(store, OWN_MS);
  return { store, database: storePaths(commonDir).database };
}

/** Holds the write lock from this thread until the returned release. */
function holdHere(database: string): () => void {
  const db = new DatabaseSync(database);
  db.exec("BEGIN IMMEDIATE");
  return () => {
    db.exec("COMMIT");
    db.close();
  };
}

/** Holds the write lock `ms` from a worker thread, so a write here can wait on it; resolves once held. */
async function holdElsewhere(database: string, ms: number): Promise<{ released: Promise<void> }> {
  const worker = new Worker(
    `const { DatabaseSync } = require("node:sqlite");
     const { workerData, parentPort } = require("node:worker_threads");
     const db = new DatabaseSync(workerData.database);
     db.exec("BEGIN IMMEDIATE");
     parentPort.postMessage("holding");
     Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, workerData.ms);
     db.exec("COMMIT");
     db.close();`,
    { eval: true, workerData: { database, ms } },
  );
  const released = new Promise<void>((resolve) => worker.once("exit", () => resolve()));
  await new Promise((resolve) => worker.once("message", resolve));
  return { released };
}

function timed(fn: () => void): { error: unknown; ms: number } {
  const start = performance.now();
  try {
    fn();
    return { error: null, ms: performance.now() - start };
  } catch (error) {
    return { error, ms: performance.now() - start };
  }
}

describe("a busy slice (001-422)", () => {
  it("gives up a write and a transaction after the slice, and restores the store's own wait", () => {
    const { store, database } = busyStore();
    const release = holdHere(database);
    try {
      for (const write of [
        () => store.meta.set("slice", "autocommit"),
        () => store.transaction(() => store.meta.set("slice", "transaction")),
      ]) {
        const { error, ms } = timed(() => withBusySliceSync(SLICE_MS, write));
        expect(isBusy(error)).toBe(true);
        expect(ms).toBeLessThan(OWN_MS / 2);
        expect(inspectConnection(store).busyTimeoutMs).toBe(OWN_MS);
      }
    } finally {
      release();
    }
    withBusySliceSync(SLICE_MS, () => store.meta.set("slice", "free"));
    expect(store.meta.get("slice")).toBe("free");
  });

  it("holds across an async pass's awaits", async () => {
    const { store, database } = busyStore();
    const release = holdHere(database);
    try {
      const start = performance.now();
      const pass = withBusySlice(SLICE_MS, async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        store.transaction(() => store.meta.set("slice", "pass"));
      });
      await expect(pass).rejects.toSatisfy(isBusy);
      expect(performance.now() - start).toBeLessThan(OWN_MS / 2);
    } finally {
      release();
    }
  });

  it("never shortens the wait of work left running once the slice settled", async () => {
    const { store, database } = busyStore();
    const { released } = await holdElsewhere(database, 4 * SLICE_MS);
    let later: Promise<unknown> = Promise.resolve();
    await withBusySlice(SLICE_MS, async () => {
      later = new Promise((resolve) =>
        setTimeout(() => resolve(timed(() => store.meta.set("slice", "later"))), 0),
      );
    });
    const { error, ms } = (await later) as { error: unknown; ms: number };
    expect(error).toBeNull();
    expect(ms).toBeGreaterThan(SLICE_MS);
    expect(store.meta.get("slice")).toBe("later");
    await released;
  });

  it("never lengthens a shorter wait of the store's own", () => {
    const { store, database } = busyStore();
    setBusyTimeout(store, 20);
    const release = holdHere(database);
    try {
      const { error, ms } = timed(() => withBusySliceSync(2_000, () => store.meta.set("k", "v")));
      expect(isBusy(error)).toBe(true);
      expect(ms).toBeLessThan(1_000);
      expect(inspectConnection(store).busyTimeoutMs).toBe(20);
    } finally {
      release();
    }
  });
});

describe("a busy episode's note (001-422)", () => {
  it("is one, after the last waiter ran, naming what waited", () => {
    let at = 1_000;
    const notes: string[] = [];
    const waits = new BusyWaits({ now: () => at, note: (text) => notes.push(text) });
    waits.waiting("pass");
    waits.waiting("the heartbeat", "the heartbeat");
    at += 6_000;
    waits.waiting("the heartbeat", "the heartbeat");
    waits.waiting("pass");
    at += 6_200;
    waits.ran("the heartbeat");
    expect(notes).toEqual([]);
    waits.ran("pass", "revision 4");
    waits.ran("pass", "revision 5");
    waits.ran("unknown");
    expect(notes).toEqual([
      "the store was busy for 12.2 s (another connection held its write lock); " +
        "ran once it was free: the heartbeat, revision 4",
    ]);
    waits.waiting("scheduler", "2 files of a tier queued again");
    at += 300;
    waits.ran("scheduler");
    expect(notes).toHaveLength(2);
    expect(notes[1]).toMatch(/busy for 0.3 s .*: 2 files of a tier queued again$/);
  });
});
