import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  createPermitPool,
  type PermitPool,
  type PoolCapacity,
  type PoolLane,
  type PoolLease,
} from "../../src/core/capacity/index.js";
import { readMarks } from "../../src/core/capacity/marks.js";

/*
 * Spec 001 D11 Capacity (task 001-376): the slow slot's lock files extended
 * into one per-user pool. Each pool here is one simulated daemon; they share
 * a temporary directory, never the user's runtime directory. Every tier
 * starts as the scheduler starts one (`startTier`): acquire, then shrink to
 * the files that start (review 001-384, B1: tests that skipped the shrink
 * missed the demand it erased). The pool is the host's slots, every backlog
 * worker a permit (011 C10 as amended 2026-10-21, row 011-96).
 */

let root: string;
let dir: string;
let clock: number;
const pools: PermitPool[] = [];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "squeal-pool-test-"));
  dir = join(root, "squeal-uid");
  clock = Date.now();
});

afterEach(() => {
  for (const pool of pools.splice(0)) pool.close();
  rmSync(root, { recursive: true, force: true });
});

function daemon(worktreeId: string, capacity: PoolCapacity = { hostSlots: 8 }): PermitPool {
  const pool = createPermitPool({
    dir,
    owner: { pid: process.pid, worktreeId },
    now: () => clock,
    ...capacity,
  });
  pools.push(pool);
  return pool;
}

/** A backlog tier of `files` files, as `selectTier` and `startTier` take its lease. */
function tier(pool: PermitPool, files: number, lane?: PoolLane): PoolLease | null {
  const lease = pool.acquire(files, lane);
  lease?.shrinkTo(files);
  return lease;
}

/** What the other daemons read in `id`'s mark. */
function markOf(id: string): { want: number; grant: number } | undefined {
  const mark = readMarks(dir, "reader", clock).find((m) => m.id === id);
  return mark === undefined ? undefined : { want: mark.want, grant: mark.grant };
}

/**
 * Since when `id`'s mark says it has waited; `null` while it has its share.
 * A mark's age is its file's real mtime, so it is read at the real time.
 */
function sinceOf(id: string): number | null | undefined {
  return readMarks(dir, "reader", Date.now()).find((m) => m.id === id)?.since;
}

describe("the per-user permit pool", () => {
  test("a lone daemon takes the host's slots, every one a permit", () => {
    const lease = tier(daemon("a"), 200);
    expect(lease?.grant).toBe(8);
    expect(lease?.permits).toBe(8);
  });

  test("a tier that wants fewer workers takes fewer permits; one file takes one", () => {
    const a = daemon("a");
    expect(tier(a, 1)?.permits).toBe(1);
    const b = tier(daemon("b"), 3);
    expect(b?.grant).toBe(3);
  });

  test("fair share across daemons: the newcomer waits, marked, then both run their share", () => {
    const a = daemon("a");
    const b = daemon("b");
    const first = tier(a, 200);
    expect(first?.grant).toBe(8);

    // No preemption: a's tier keeps its permits, b runs nothing and marks itself waiting.
    clock += 1_000;
    expect(tier(b, 200)).toBeNull();
    expect(markOf("b")).toEqual({ want: 200, grant: 0 });
    expect(sinceOf("b")).toBe(clock);

    // At a's next tier boundary it takes no more than its share and leaves b's lack free.
    first?.release();
    clock += 1_000;
    const second = tier(a, 200);
    expect(second?.grant).toBe(4);

    clock += 1_000;
    expect(tier(b, 200)?.grant).toBe(4);
    expect(sinceOf("b")).toBeNull();
  });

  test("two daemons on 2 slots: the second gets nothing while the first holds both, and holds no permit", () => {
    const a = daemon("a", { hostSlots: 2 });
    const b = daemon("b", { hostSlots: 2 });
    const held = tier(a, 5);
    expect(held?.permits).toBe(2);
    clock += 1_000;
    expect(b.acquire(5)).toBeNull();
    expect(markOf("b")).toEqual({ want: 5, grant: 0 });
    // b's look took and returned what it counted: a's next tier still finds its share free.
    held?.release();
    clock += 1_000;
    expect(tier(a, 1)?.permits).toBe(1);
    expect(tier(b, 5)?.grant).toBe(1);
  });

  test("with more daemons than slots, the one whose share is none waits and is served first at the next boundary", () => {
    const a = daemon("a", { hostSlots: 2 });
    const b = daemon("b", { hostSlots: 2 });
    const c = daemon("c", { hostSlots: 2 });
    const first = tier(a, 200);
    expect(first?.grant).toBe(2);
    clock += 1_000;
    expect(tier(b, 200)).toBeNull();
    clock += 1_000;
    expect(tier(c, 200)).toBeNull();
    // c's share was 0 behind a and the older waiter b; it waits, so it is not left behind by id.
    expect(sinceOf("c")).toBe(clock);
    first?.release();
    clock += 1_000;
    // a's boundary leaves both permits to the waiters, the older first.
    expect(tier(a, 200)).toBeNull();
    expect(tier(b, 200)?.grant).toBe(1);
    expect(tier(c, 200)?.grant).toBe(1);
  });

  test("a waiter that stops looking forgets how long it waited after 30 s", () => {
    tier(daemon("a"), 200);
    const b = daemon("b");
    clock += 1_000;
    expect(tier(b, 200)).toBeNull();
    const since = clock;
    clock += 1_000;
    expect(tier(b, 200)).toBeNull();
    expect(sinceOf("b")).toBe(since);
    // b had no backlog work for 30 s: when it waits again, it is the newest waiter.
    clock += 30_000;
    expect(tier(b, 200)).toBeNull();
    expect(sinceOf("b")).toBe(clock);
  });

  test("slots one daemon cannot use go to the others", () => {
    const a = daemon("a");
    const b = daemon("b");
    const c = daemon("c");
    expect(tier(c, 2)?.grant).toBe(2);
    // c wants only 2: b, alone beside it, takes the other 6.
    const wide = tier(b, 200);
    expect(wide?.grant).toBe(6);
    // a's share of the 6 is 3; no permit is free, so it waits for them.
    clock += 1_000;
    expect(tier(a, 200)).toBeNull();
    // b's next boundary leaves a its lack; then a runs its share.
    wide?.release();
    clock += 1_000;
    expect(tier(b, 200)?.grant).toBe(3);
    clock += 1_000;
    expect(tier(a, 200)?.grant).toBe(3);
  });

  test("the longest waiter is served first, whichever reaches its boundary first", () => {
    for (const [older, younger] of [
      ["b", "c"],
      ["c", "b"],
    ] as const) {
      const a = daemon(`a-${older}`);
      const pools = { b: daemon(`b-${older}`), c: daemon(`c-${older}`) };
      const holder = tier(a, 200);
      expect(holder?.grant).toBe(8);
      // Both wait with nothing, `older` since earlier.
      clock += 1_000;
      expect(tier(pools[older], 200)).toBeNull();
      clock += 1_000;
      expect(tier(pools[younger], 200)).toBeNull();

      // The holder gives back two permits, then has no more backlog work.
      holder?.shrinkTo(6);
      // The younger waiter looks first, yet it leaves both permits to the older.
      clock += 1_000;
      expect(tier(pools[younger], 200)).toBeNull();
      clock += 1_000;
      expect(tier(pools[older], 200)?.grant).toBe(2);

      for (const pool of [a, pools.b, pools.c]) pool.close();
    }
  });

  // Task 004-61: when permits are short, fast files are granted first.
  test("a fast lane's waiter is served before an older slow lane's, whichever reaches its boundary first", () => {
    for (const first of ["slow", "fast"] as const) {
      const a = daemon(`a-${first}`);
      const slow = daemon(`slow-${first}`);
      const fast = daemon(`fast-${first}`);
      const holder = tier(a, 200);
      expect(holder?.grant).toBe(8);
      // Both wait with nothing, the slow lane's since earlier.
      clock += 1_000;
      expect(tier(slow, 200, "slow")).toBeNull();
      clock += 1_000;
      expect(tier(fast, 200)).toBeNull();
      expect(readMarks(dir, "reader", clock).find((m) => m.id === `slow-${first}`)?.slow).toBe(
        true,
      );

      // The holder gives back two permits, then has no more backlog work.
      holder?.shrinkTo(6);
      if (first === "slow") {
        // The older slow waiter looks first, yet it leaves both permits to the fast one.
        clock += 1_000;
        expect(tier(slow, 200, "slow")).toBeNull();
      }
      clock += 1_000;
      expect(tier(fast, 200)?.grant).toBe(2);
      for (const pool of [a, slow, fast]) pool.close();
    }
  });

  test("a lane's release leaves the other lane's demand in the mark, not its grant", () => {
    const a = daemon("a");
    const laneOne = tier(a, 3);
    expect(laneOne?.grant).toBe(3);
    const laneTwo = tier(a, 50);
    expect(laneTwo?.grant).toBe(5);
    expect(markOf("a")).toEqual({ want: 53, grant: 8 });
    laneOne?.release();
    expect(markOf("a")).toEqual({ want: 50, grant: 5 });
    // A newcomer's share is still half: a's lane two wants far more than it holds.
    clock += 1_000;
    expect(tier(daemon("b"), 200)?.grant).toBe(3);
    expect(markOf("b")).toEqual({ want: 200, grant: 3 });
  });

  test("a daemon whose other lane holds its share waits for more, and is no waiter", () => {
    const a = daemon("a", { hostSlots: 4 });
    const b = daemon("b", { hostSlots: 4 });
    const other = tier(b, 2);
    expect(other?.grant).toBe(2);
    expect(tier(a, 2)?.grant).toBe(2);
    // a's share is the 2 its first lane holds: its second lane may not start, and a lacks nothing.
    expect(tier(a, 5)).toBeNull();
    expect(sinceOf("a")).toBeNull();
    other?.release();
    expect(tier(a, 5)?.grant).toBe(2);
  });

  test("a capped project's daemons together stay within its slots", () => {
    const project = { id: "/repo/p", slots: 4 };
    const p1 = daemon("p1", { hostSlots: 8, project });
    const p2 = daemon("p2", { hostSlots: 8, project });
    expect(tier(p1, 200)?.grant).toBe(4);
    // No preemption: p1 holds the project's slots, p2 waits.
    expect(tier(p2, 200)).toBeNull();
    expect(tier(daemon("q"), 200)?.grant).toBe(4);
  });
});
