import { mkdirSync, statSync } from "node:fs";
import { dirname } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CHECKPOINT_BUSY_MS,
  IDLE_CHECKPOINT_MS,
  IdleCheckpoint,
  truncateWal,
  type WorkSeen,
} from "../../src/core/daemon/idle-checkpoint.js";
import { startTimers } from "../../src/core/daemon/lifecycle.js";
import { JOURNAL_SIZE_LIMIT_BYTES } from "../../src/core/store/open.js";
import { storePaths } from "../../src/core/store/paths.js";
import { connectionOf } from "../../src/core/store/store.js";
import { DEFAULT_POLICY } from "../../src/core/types/policy.js";
import type { Store } from "../../src/core/types/store.js";
import { fakeCommonDir, open } from "../store/helpers.js";
import { delay, waitFor } from "./helpers.js";

/*
 * Spec 021 D3 and D4 (row 021-09): the daemon's timers log a write held past
 * 250 ms, and a daemon quiet for a minute cuts the store's WAL to zero bytes
 * with a `TRUNCATE` checkpoint. Every opener limits the WAL's size.
 */

const stops: (() => void)[] = [];
afterEach(() => {
  for (const stop of stops.splice(0)) stop();
});

const QUIET: WorkSeen = { revision: 3, inUse: false, queued: 0 };

/** The real timers over `store`, checking every 10 ms, at the clock and work the test sets. */
function timers(commonDir: string, store: Store) {
  mkdirSync(storePaths(commonDir).locksDir, { recursive: true });
  const state = { clock: 1_000_000, work: QUIET as WorkSeen | null, logged: [] as string[] };
  const stop = startTimers({
    root: dirname(commonDir),
    worktreeId: "0123456789abcdef",
    commonDir,
    store,
    policy: DEFAULT_POLICY,
    now: () => state.clock,
    linkedDir: null,
    timings: { checkMs: 10, presenceMs: 60_000, expireMs: 3_600_000, firstPruneMs: 3_600_000 },
    heartbeatMs: 3_600_000,
    presence: { since: 1_000, lastPresentAt: null },
    lastActive: () => state.clock,
    active: () => {},
    work: () => state.work,
    note: () => {},
    log: (line) => state.logged.push(line),
    shutdown: () => {},
  });
  stops.push(stop);
  return { state, stop };
}

/** A store whose WAL a reader kept from restarting while 4 MB were written, past a 1 MiB limit. */
function grownWal() {
  const commonDir = fakeCommonDir();
  const store = open(commonDir);
  connectionOf(store).db.exec("PRAGMA journal_size_limit = 1048576");
  const reader = connectionOf(open(commonDir)).db;
  reader.exec("BEGIN");
  reader.prepare("SELECT count(*) FROM meta").get();
  store.transaction(() => store.meta.set("big", "x".repeat(4 * 1024 * 1024)));
  reader.exec("COMMIT");
  const wal = `${storePaths(commonDir).database}-wal`;
  expect(statSync(wal).size).toBeGreaterThan(1024 * 1024);
  return { commonDir, store, wal, reader };
}

function sleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

describe("the WAL's size (spec 021 D4)", () => {
  it("is limited on every store connection", () => {
    const store = open(fakeCommonDir());
    const limit = connectionOf(store).db.prepare("PRAGMA journal_size_limit").get();
    expect(Object.values(limit ?? {})).toEqual([JOURNAL_SIZE_LIMIT_BYTES]);
  });

  it("is cut to zero bytes once the daemon was quiet a minute, and not before", async () => {
    const { commonDir, store, wal } = grownWal();
    const before = statSync(wal).size;
    const { state } = timers(commonDir, store);
    await delay(100);
    state.clock += IDLE_CHECKPOINT_MS - 1_000;
    await delay(100);
    expect(statSync(wal).size).toBe(before);
    state.clock += 1_000;
    await waitFor(() => statSync(wal).size === 0, 5_000, "the WAL cut to zero bytes");
    expect(store.meta.get("big")).toHaveLength(4 * 1024 * 1024);
  });

  it("is left alone while the daemon has work", async () => {
    const { commonDir, store, wal } = grownWal();
    const before = statSync(wal).size;
    const { state } = timers(commonDir, store);
    state.work = { ...QUIET, inUse: true };
    await delay(50);
    state.clock += 2 * IDLE_CHECKPOINT_MS;
    await delay(100);
    expect(statSync(wal).size).toBe(before);
  });
});

describe("the checkpoint", () => {
  it("gives up in its busy timeout while a reader holds an older state, and restores the timeout", () => {
    const { store, reader } = grownWal();
    const db = connectionOf(store).db;
    store.transaction(() => store.meta.set("after", "1"));
    reader.exec("BEGIN");
    reader.prepare("SELECT count(*) FROM meta").get();
    store.transaction(() => store.meta.set("later", "1"));
    const started = performance.now();
    expect(truncateWal(db, CHECKPOINT_BUSY_MS)?.busy).toBe(true);
    expect(performance.now() - started).toBeLessThan(2_000);
    expect(Object.values(db.prepare("PRAGMA busy_timeout").get() ?? {})).toEqual([10_000]);
    reader.exec("COMMIT");
    expect(truncateWal(db, CHECKPOINT_BUSY_MS)).toEqual({ busy: false, log: 0, checkpointed: 0 });
  });

  it("runs nothing inside a transaction", () => {
    const conn = connectionOf(open(fakeCommonDir()));
    conn.read(() => expect(truncateWal(conn.db, CHECKPOINT_BUSY_MS)).toBeNull());
  });

  it("is due after a quiet minute, again a minute after each try, and never across a change", () => {
    const idle = new IdleCheckpoint();
    const minute = IDLE_CHECKPOINT_MS;
    expect(idle.due(0, null)).toBe(false);
    expect(idle.due(1, QUIET)).toBe(false);
    expect(idle.due(minute, QUIET)).toBe(false);
    expect(idle.due(minute + 1, QUIET)).toBe(true);
    expect(idle.due(minute + 2, QUIET)).toBe(false);
    expect(idle.due(2 * minute + 1, QUIET)).toBe(true);
    // A new revision, queued work or a pending edit starts the minute again.
    expect(idle.due(2 * minute + 2, { ...QUIET, revision: 4 })).toBe(false);
    expect(idle.due(3 * minute + 1, { ...QUIET, revision: 4 })).toBe(false);
    expect(idle.due(3 * minute + 2, { ...QUIET, revision: 4 })).toBe(true);
    expect(idle.due(3 * minute + 3, { ...QUIET, revision: 4, queued: 2 })).toBe(false);
    expect(idle.due(5 * minute, { ...QUIET, revision: 4 })).toBe(false);
  });
});

describe("the daemon's log of long writes (spec 021 D3)", () => {
  it("has a line for a write held 300 ms, and none once the timers stopped", async () => {
    const commonDir = fakeCommonDir();
    const store = open(commonDir);
    const { state, stop } = timers(commonDir, store);
    state.work = null;
    const slowWrite = () =>
      store.transaction(() => {
        store.meta.set("slow", "1");
        sleep(300);
      });
    slowWrite();
    expect(state.logged).toHaveLength(1);
    expect(state.logged[0]).toMatch(
      /^long write: store\.sqlite write lock held \d+ ms by slowWrite\b.*; 1 row written$/,
    );
    stop();
    slowWrite();
    expect(state.logged).toHaveLength(1);
  });
});
