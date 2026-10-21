import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  daemonUsedMetaKey,
  readDaemonUsed,
  recordDaemonUsed,
} from "../../src/core/daemon/last-use.js";
import { startTimers } from "../../src/core/daemon/lifecycle.js";
import { storePaths } from "../../src/core/store/index.js";
import { DEFAULT_POLICY, type Store } from "../../src/core/types/index.js";
import { fakeCommonDir, open, worktree } from "../store/helpers.js";
import { delay, waitFor } from "./helpers.js";

/*
 * Spec 014 D9 (row 014-08): with each heartbeat the daemon records when it
 * was last used and last active, `daemon-used:<worktree id>` in `meta`, so
 * `squeal ps` can read what only the daemon's memory held. Its reader knows
 * `{ v: 1, usedAt, activeAt }` and nothing else, and reads a row a
 * predecessor left as none: a daemon's use is never before its start.
 */

const WT = "0123456789abcdef";

describe("the last-use row (spec 014 D9)", () => {
  it("is the worktree's daemon-used row", () => {
    expect(daemonUsedMetaKey(WT)).toBe(`daemon-used:${WT}`);
  });

  it("holds { v: 1, usedAt, activeAt }, and the reader reads it back", () => {
    const store = open(fakeCommonDir());
    recordDaemonUsed(store, WT, { usedAt: 2_000, activeAt: 1_500 });
    const value = store.meta.get(daemonUsedMetaKey(WT));
    expect(JSON.parse(value ?? "null")).toEqual({ v: 1, usedAt: 2_000, activeAt: 1_500 });
    expect(readDaemonUsed(value, 1_000)).toEqual({ usedAt: 2_000, activeAt: 1_500 });
  });

  it("reads a row a predecessor left under a daemon of a release that writes none as none", () => {
    const store = open(fakeCommonDir());
    const record = (startedAt: number) => ({
      socketPath: "/tmp/squeal.sock",
      startedAt,
      heartbeatAt: startedAt,
      heartbeatIntervalMs: 5_000,
      squealVersion: "0.0.0",
    });
    store.worktrees.upsert(worktree(WT, "/wt", { daemon: record(1_000) }));
    recordDaemonUsed(store, WT, { usedAt: 4_000, activeAt: 3_000 });
    const read = () =>
      readDaemonUsed(
        store.meta.get(daemonUsedMetaKey(WT)),
        store.worktrees.get(WT)?.daemon?.startedAt ?? 0,
      );
    expect(read()).toEqual({ usedAt: 4_000, activeAt: 3_000 });

    // The older release registers and leaves the row as it found it.
    store.worktrees.setDaemon(WT, record(5_000));
    expect(read()).toBeNull();
    // Its own start is this daemon's first use: the row it writes at registration.
    expect(readDaemonUsed('{"v":1,"usedAt":5000,"activeAt":5000}', 5_000)).toEqual({
      usedAt: 5_000,
      activeAt: 5_000,
    });
  });

  it("reads a v: 1 value with a key added beside its own", () => {
    expect(readDaemonUsed('{"v":1,"usedAt":5,"activeAt":4,"later":true}', 0)).toEqual({
      usedAt: 5,
      activeAt: 4,
    });
  });

  it("reads null for any value it does not know", () => {
    for (const value of [
      null,
      "",
      "{",
      "null",
      "[]",
      "1",
      '"x"',
      '{"usedAt":5,"activeAt":4}',
      '{"v":2,"usedAt":5,"activeAt":4}',
      '{"v":"1","usedAt":5,"activeAt":4}',
      '{"v":1,"activeAt":4}',
      '{"v":1,"usedAt":5}',
      '{"v":1,"usedAt":"5","activeAt":4}',
      '{"v":1,"usedAt":5,"activeAt":null}',
      '{"v":1,"usedAt":-1,"activeAt":4}',
      '{"v":1,"usedAt":5.5,"activeAt":4}',
      '{"v":1,"usedAt":1e400,"activeAt":4}',
    ]) {
      expect(readDaemonUsed(value, 0), String(value)).toBeNull();
    }
  });
});

const stops: (() => void)[] = [];
afterEach(() => {
  for (const stop of stops.splice(0)) stop();
});

interface Beating {
  readonly store: Store;
  readonly clocks: { used: number; active: number };
  /** What the timers logged: a failed write. */
  readonly logged: string[];
  read(): ReturnType<typeof readDaemonUsed>;
}

/** The real timers over a store, heartbeating every 10 ms, with the clocks the test sets. */
function beating(registered: boolean): Beating {
  const commonDir = fakeCommonDir();
  const store = open(commonDir);
  mkdirSync(storePaths(commonDir).locksDir, { recursive: true });
  const daemon = {
    socketPath: "/tmp/squeal.sock",
    startedAt: 1_000,
    heartbeatAt: 1_000,
    heartbeatIntervalMs: 10,
    squealVersion: "0.0.0",
  };
  if (registered) store.worktrees.upsert(worktree(WT, "/wt", { daemon }));
  const clocks = { used: 1_000, active: 1_000 };
  const logged: string[] = [];
  stops.push(
    startTimers({
      root: dirname(commonDir),
      worktreeId: WT,
      commonDir,
      store,
      policy: DEFAULT_POLICY,
      now: () => Math.max(clocks.used, clocks.active),
      linkedDir: null,
      timings: { checkMs: 60_000, presenceMs: 60_000 },
      heartbeatMs: 10,
      presence: { since: 1_000, lastPresentAt: null },
      lastActive: () => clocks.active,
      active: (at) => {
        clocks.active = at;
      },
      lastUsed: () => clocks.used,
      used: (at) => {
        clocks.used = at;
      },
      note: () => {},
      log: (line) => logged.push(line),
      shutdown: () => {},
    }),
  );
  return {
    store,
    clocks,
    logged,
    read: () => readDaemonUsed(store.meta.get(daemonUsedMetaKey(WT)), 1_000),
  };
}

describe("the heartbeat records the last use (spec 014 D9)", { timeout: 30_000 }, () => {
  it("writes the daemon's clocks with each heartbeat, as they move", async () => {
    const { store, clocks, logged, read } = beating(true);
    await waitFor(() => read() !== null, 10_000, "the first heartbeat's row");
    expect(read()).toEqual({ usedAt: 1_000, activeAt: 1_000 });

    clocks.used = 7_000;
    clocks.active = 5_000;
    await waitFor(() => read()?.usedAt === 7_000, 10_000, "the moved clocks");
    expect(read()).toEqual({ usedAt: 7_000, activeAt: 5_000 });
    // In the heartbeat's write: the same tick moved the record's heartbeat.
    expect(store.worktrees.get(WT)?.daemon?.heartbeatAt).toBeGreaterThanOrEqual(7_000);
    expect(logged).toEqual([]);
  });

  it("writes no row while the worktree has no daemon record, as the heartbeat writes none", async () => {
    const { store, logged, read } = beating(false);
    await delay(100);
    expect(read()).toBeNull();
    expect(store.worktrees.get(WT)).toBeNull();
    expect(logged).toEqual([]);
  });
});
