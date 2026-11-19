import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { oncePerClone, PRUNED_AT_KEY } from "../../src/core/daemon/clone-prune.js";
import { startTimers } from "../../src/core/daemon/lifecycle.js";
import { storePaths } from "../../src/core/store/paths.js";
import { connectionOf } from "../../src/core/store/store.js";
import { DEFAULT_POLICY } from "../../src/core/types/policy.js";
import type { Store } from "../../src/core/types/store.js";
import { fakeCommonDir, open } from "../store/helpers.js";
import { delay, waitFor } from "./helpers.js";

/*
 * Row 021-33: every daemon of a clone has a prune timer, but the clone's
 * shared stores are pruned once per interval. A mark in the main store
 * names the last prune's start; a daemon that finds it fresh prunes nothing.
 */

const INTERVAL_MS = 60 * 60_000;
const stops: (() => void)[] = [];
afterEach(() => {
  for (const stop of stops.splice(0)) stop();
});

/** Runs `oncePerClone` at `at` to its end; whether it pruned. */
function pruneAt(store: Store, at: number): boolean {
  let pruned = false;
  let claimed = false;
  const slices = oncePerClone(
    store,
    at,
    INTERVAL_MS,
    () => [
      () => {
        pruned = true;
      },
    ],
    () => {
      claimed = true;
    },
  );
  for (const slice of slices) slice();
  expect(claimed).toBe(pruned);
  return pruned;
}

describe("the clone's prune mark (row 021-33)", () => {
  it("lets one prune begin per interval, whichever daemon's store asks", () => {
    const commonDir = fakeCommonDir();
    const a = open(commonDir);
    const b = open(commonDir);
    expect(pruneAt(a, 1_000_000)).toBe(true);
    expect(pruneAt(b, 1_000_000 + 1_000)).toBe(false);
    expect(pruneAt(a, 1_000_000 + 30 * 60_000)).toBe(false);
    // A minute early is still this interval's turn: timers drift.
    expect(pruneAt(b, 1_000_000 + INTERVAL_MS - 60_000)).toBe(true);
    expect(pruneAt(a, 1_000_000 + INTERVAL_MS)).toBe(false);
    expect(b.meta.get(PRUNED_AT_KEY)).toBe(String(1_000_000 + INTERVAL_MS - 60_000));
  });

  it("takes no write lock when the mark is fresh", () => {
    const commonDir = fakeCommonDir();
    const a = open(commonDir);
    expect(pruneAt(a, 1_000_000)).toBe(true);
    const holder = connectionOf(open(commonDir)).db;
    holder.exec("BEGIN IMMEDIATE");
    connectionOf(a).db.exec("PRAGMA busy_timeout = 0");
    try {
      expect(pruneAt(a, 1_000_000 + 1_000)).toBe(false);
    } finally {
      holder.exec("ROLLBACK");
    }
  });

  it("treats a mark ahead of the clock or unreadable as stale", () => {
    const store = open(fakeCommonDir());
    store.meta.set(PRUNED_AT_KEY, String(5_000_000));
    expect(pruneAt(store, 1_000_000)).toBe(true);
    store.meta.set(PRUNED_AT_KEY, "not a time");
    expect(pruneAt(store, 1_000_000)).toBe(true);
  });

  it("is claimed by one of two daemons that found it stale together", () => {
    const commonDir = fakeCommonDir();
    const a = open(commonDir);
    const b = open(commonDir);
    const ran: string[] = [];
    const made = (store: Store, name: string) =>
      oncePerClone(
        store,
        1_000_000,
        INTERVAL_MS,
        () => [() => ran.push(name)],
        () => {},
      )[Symbol.iterator]();
    const first = made(a, "a");
    const second = made(b, "b");
    // Both read the mark before either claims it.
    first.next().value?.();
    second.next().value?.();
    for (let step = first.next(); step.done !== true; step = first.next()) step.value();
    for (let step = second.next(); step.done !== true; step = second.next()) step.value();
    expect(ran).toEqual(["a"]);
  });
});

/** Counts each claim of the mark, by any connection, in a table of the store. */
function countClaims(store: Store): () => number {
  const conn = connectionOf(store);
  conn.db.exec(`CREATE TABLE claims (at TEXT NOT NULL);
    CREATE TRIGGER claim AFTER INSERT ON meta WHEN new.key = '${PRUNED_AT_KEY}'
    BEGIN INSERT INTO claims VALUES (new.value); END;`);
  return () => Number(conn.get("SELECT count(*) AS n FROM claims")?.n);
}

/** One daemon's real timers on `commonDir`, its prune every `pruneMs`, at `clock`'s time. */
function daemon(commonDir: string, worktreeId: string, clock: { now: number }, pruneMs: number) {
  mkdirSync(storePaths(commonDir).locksDir, { recursive: true });
  const stop = startTimers({
    root: dirname(commonDir),
    worktreeId,
    commonDir,
    store: open(commonDir),
    policy: DEFAULT_POLICY,
    now: () => clock.now,
    linkedDir: null,
    timings: {
      checkMs: 3_600_000,
      presenceMs: 60_000,
      expireMs: 3_600_000,
      pruneMs,
      firstPruneMs: 0,
    },
    heartbeatMs: 3_600_000,
    presence: { since: 1_000, lastPresentAt: null },
    lastActive: () => clock.now,
    active: () => {},
    work: () => null,
    note: () => {},
    log: () => {},
    shutdown: () => {},
  });
  stops.push(stop);
}

describe("two daemons on one clone (row 021-33)", () => {
  it("prune once per interval", async () => {
    const commonDir = fakeCommonDir();
    const claims = countClaims(open(commonDir));
    const clock = { now: 1_000_000 };
    const pruneMs = 40;
    daemon(commonDir, "0123456789abcdef", clock, pruneMs);
    daemon(commonDir, "fedcba9876543210", clock, pruneMs);
    await waitFor(() => claims() === 1, 5_000, "the first prune");
    // Each timer fires several times within the interval the clock stands in.
    await delay(pruneMs * 6);
    expect(claims()).toBe(1);
    clock.now += pruneMs;
    await waitFor(() => claims() === 2, 5_000, "the next interval's prune");
    await delay(pruneMs * 6);
    expect(claims()).toBe(2);
  });
});
