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

/** One `oncePerClone` over `store` at `clock`'s time, whose prune records `name` in `ran`. */
function made(store: Store, clock: () => number, name: string, ran: string[]) {
  return oncePerClone(
    store,
    clock,
    INTERVAL_MS,
    () => [
      () => {
        ran.push(name);
      },
    ],
    () => {},
  )[Symbol.iterator]();
}

/** Runs the rest of `slices`. */
function finish(slices: Iterator<() => void>): void {
  for (let step = slices.next(); step.done !== true; step = slices.next()) step.value();
}

/** Runs `oncePerClone` at `at` to its end; whether it pruned. */
function pruneAt(store: Store, at: number): boolean {
  let pruned = false;
  let claimed = false;
  const slices = oncePerClone(
    store,
    () => at,
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

const T = 1_000_000;

describe("the clone's prune mark (row 021-33)", () => {
  it("lets one prune per full interval, whichever daemon's store asks", () => {
    const commonDir = fakeCommonDir();
    const a = open(commonDir);
    const b = open(commonDir);
    expect(pruneAt(a, T)).toBe(true);
    expect(pruneAt(b, T + 1_000)).toBe(false);
    expect(pruneAt(a, T + 30 * 60_000)).toBe(false);
    expect(pruneAt(b, T + INTERVAL_MS - 1)).toBe(false);
    expect(pruneAt(b, T + INTERVAL_MS)).toBe(true);
    expect(pruneAt(a, T + INTERVAL_MS + 1)).toBe(false);
    expect(a.meta.get(PRUNED_AT_KEY)).toBe(String(T + INTERVAL_MS));
  });

  it("takes no write lock when the mark is fresh", () => {
    const commonDir = fakeCommonDir();
    const a = open(commonDir);
    expect(pruneAt(a, T)).toBe(true);
    const holder = connectionOf(open(commonDir)).db;
    holder.exec("BEGIN IMMEDIATE");
    connectionOf(a).db.exec("PRAGMA busy_timeout = 0");
    try {
      expect(pruneAt(a, T + 1_000)).toBe(false);
    } finally {
      holder.exec("ROLLBACK");
    }
  });

  it("treats a mark ahead of the clock when read, or unreadable, as due (the clock moved back)", () => {
    const store = open(fakeCommonDir());
    store.meta.set(PRUNED_AT_KEY, String(5 * T));
    expect(pruneAt(store, T)).toBe(true);
    store.meta.set(PRUNED_AT_KEY, "not a time");
    expect(pruneAt(store, T)).toBe(true);
  });

  it.each([
    ["the earlier reader claims first", ["a", "b"], "a"],
    ["the later reader claims first", ["b", "a"], "b"],
  ] as const)("lets one of two daemons that read at different times prune: %s", (_, order, won) => {
    const commonDir = fakeCommonDir();
    const stores = { a: open(commonDir), b: open(commonDir) };
    const times = { a: T, b: T + 1 };
    const ran: string[] = [];
    const slices = {
      a: made(stores.a, () => times.a, "a", ran),
      b: made(stores.b, () => times.b, "b", ran),
    };
    // Both read the empty mark before either claims.
    slices.a.next().value?.();
    slices.b.next().value?.();
    for (const name of order) finish(slices[name]);
    expect(ran).toEqual([won]);
    expect(stores.a.meta.get(PRUNED_AT_KEY)).toBe(String(times[won]));
  });

  it("loses to a newer mark a competitor wrote after its read, though that mark is ahead of its clock", () => {
    const commonDir = fakeCommonDir();
    const a = open(commonDir);
    const b = open(commonDir);
    const ran: string[] = [];
    const late = made(a, () => T, "a", ran);
    late.next().value?.();
    expect(pruneAt(b, T + 5_000)).toBe(true);
    finish(late);
    expect(ran).toEqual([]);
    expect(a.meta.get(PRUNED_AT_KEY)).toBe(String(T + 5_000));
  });

  it("marks a delayed claim with the time it was made", () => {
    const store = open(fakeCommonDir());
    const clock = { now: T };
    const ran: string[] = [];
    const slices = made(store, () => clock.now, "a", ran);
    slices.next().value?.();
    clock.now = T + 5_000;
    finish(slices);
    expect(ran).toEqual(["a"]);
    expect(store.meta.get(PRUNED_AT_KEY)).toBe(String(T + 5_000));
    expect(pruneAt(store, T + INTERVAL_MS)).toBe(false);
    expect(pruneAt(store, T + 5_000 + INTERVAL_MS)).toBe(true);
  });

  it("lets a claim whose prune never ran expire after one interval", () => {
    const store = open(fakeCommonDir());
    const ran: string[] = [];
    const slices = made(store, () => T, "a", ran);
    slices.next().value?.();
    slices.next().value?.();
    // The daemon stopped after its claim, before any prune slice.
    slices.return?.();
    expect(ran).toEqual([]);
    expect(pruneAt(store, T + INTERVAL_MS - 1)).toBe(false);
    expect(pruneAt(store, T + INTERVAL_MS)).toBe(true);
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
