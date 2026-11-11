import { afterEach, describe, expect, it } from "vitest";
import {
  LONG_WRITE_MS,
  type LongWrite,
  logLongWrites,
  longWriteLine,
  operationOf,
} from "../../src/core/store/long-write.js";
import type { Store } from "../../src/core/types/store.js";
import { fakeCommonDir, open } from "./helpers.js";

/*
 * Spec 021 D3 (row 021-09): a write transaction that holds the lock longer
 * than 250 ms names itself, with its duration and the WAL frames it wrote.
 */

/** Sleeps the thread, holding whatever it holds, with no CPU spent. */
function sleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

let unlog: (() => void) | null = null;
afterEach(() => {
  unlog?.();
  unlog = null;
});

function collect(): LongWrite[] {
  const writes: LongWrite[] = [];
  unlog = logLongWrites((write) => writes.push(write));
  return writes;
}

function recordSlowly(store: Store, ms: number): void {
  store.transaction(() => {
    store.meta.set("slow", "1");
    sleep(ms);
  });
}

describe("a long write transaction (spec 021 D3)", () => {
  it("tells its database, operation, duration and frames when held 300 ms", () => {
    const store = open(fakeCommonDir());
    const writes = collect();
    recordSlowly(store, 300);
    expect(writes).toHaveLength(1);
    const [write] = writes;
    expect(write?.database).toBe("store.sqlite");
    expect(write?.operation).toMatch(/^recordSlowly/);
    expect(write?.ms).toBeGreaterThanOrEqual(300);
    expect(write?.frames).toBeGreaterThanOrEqual(1);
  });

  it("tells 0 frames for a long one that wrote nothing", () => {
    const store = open(fakeCommonDir());
    const writes = collect();
    store.transaction(() => sleep(LONG_WRITE_MS + 50));
    expect(writes.map((w) => w.frames)).toEqual([0]);
  });

  it("tells nothing of a short one, of a savepoint inside one, or without a sink", () => {
    const store = open(fakeCommonDir());
    recordSlowly(store, LONG_WRITE_MS + 50);
    const writes = collect();
    store.transaction(() => store.meta.set("quick", "1"));
    expect(writes).toEqual([]);
    store.transaction(() => recordSlowly(store, LONG_WRITE_MS + 50));
    // The outer transaction is the one held; its savepoint names no second hold.
    expect(writes).toHaveLength(1);
    unlog?.();
    recordSlowly(store, LONG_WRITE_MS + 50);
    expect(writes).toHaveLength(1);
  });

  it("tells a long one that rolled back", () => {
    const store = open(fakeCommonDir());
    const writes = collect();
    expect(() =>
      store.transaction(() => {
        store.meta.set("lost", "1");
        sleep(LONG_WRITE_MS + 50);
        throw new Error("abandoned");
      }),
    ).toThrow("abandoned");
    expect(writes).toHaveLength(1);
    expect(store.meta.get("lost")).toBeNull();
  });
});

describe("the long write's log line", () => {
  it("names the database, duration, operation and frames", () => {
    const write = { database: "store.sqlite", operation: "applyBatch < pass", ms: 312, frames: 4 };
    expect(longWriteLine(write)).toBe(
      "long write: store.sqlite write lock held 312 ms by applyBatch < pass; 4 WAL frames written",
    );
    expect(longWriteLine({ ...write, frames: 1 })).toMatch(/; 1 WAL frame written$/);
    expect(longWriteLine({ ...write, database: "", frames: null })).toBe(
      "long write: a database in memory write lock held 312 ms by applyBatch < pass; WAL frames written not known",
    );
  });

  it("names the nearest three callers outside the store layer", () => {
    const stack = [
      "Error",
      "    at endWrite (file:///a/dist/index.js:10:3)",
      "    at HoldingConnection.transaction (file:///a/dist/index.js:20:3)",
      "    at Connection2.transaction (file:///a/dist/index.js:21:3)",
      "    at Object.transaction (file:///a/dist/index.js:30:3)",
      "    at Ledger.recordTier (file:///a/dist/index.js:40:3)",
      "    at file:///a/dist/runner-work.js:50:7",
      "    at async Scheduler.pass (file:///a/dist/index.js:60:3)",
      "    at main (file:///a/dist/index.js:70:3)",
    ].join("\n");
    expect(operationOf(stack)).toBe("Ledger.recordTier < runner-work.js:50 < Scheduler.pass");
    expect(operationOf("Error")).toBe("unknown");
  });
});
