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
 * missed the demand it erased).
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

describe("the per-user permit pool", () => {
  test("a lone daemon takes the host's slots: its free worker and every permit", () => {
    const lease = tier(daemon("a"), 200);
    expect(lease?.grant).toBe(8);
    expect(lease?.permits).toBe(7);
  });

  test("a tier that wants fewer workers takes fewer permits; one file runs on the free worker", () => {
    const a = daemon("a");
    expect(tier(a, 1)?.permits).toBe(0);
    const b = tier(daemon("b"), 3);
    expect(b?.grant).toBe(3);
  });

  test("fair share across daemons: the newcomer waits one tier on its free worker, then both run their share", () => {
    const a = daemon("a");
    const b = daemon("b");
    const first = tier(a, 200);
    expect(first?.grant).toBe(8);

    // No preemption: a's tier keeps its permits, b runs on its free worker and marks itself waiting.
    clock += 1_000;
    const waiting = tier(b, 200);
    expect(waiting?.grant).toBe(1);
    // Review 001-384, B1: b's shrink to the files it starts keeps its demand, not its grant.
    expect(markOf("b")).toEqual({ want: 200, grant: 1 });

    // At a's next tier boundary it takes no more than its share and leaves b's lack free.
    first?.release();
    clock += 1_000;
    const second = tier(a, 200);
    expect(second?.grant).toBe(4);

    waiting?.release();
    clock += 1_000;
    expect(tier(b, 200)?.grant).toBe(4);
  });

  test("slots one daemon cannot use go to the others", () => {
    const a = daemon("a");
    const b = daemon("b");
    const c = daemon("c");
    expect(tier(c, 2)?.grant).toBe(2);
    // c wants only 2: b, alone beside it, takes the other 6.
    const wide = tier(b, 200);
    expect(wide?.grant).toBe(6);
    // a's share of the 6 is 3; one permit is free, so it waits for the rest.
    clock += 1_000;
    const short = tier(a, 200);
    expect(short?.grant).toBe(2);
    // b's next boundary leaves a its lack; then a runs its share.
    wide?.release();
    clock += 1_000;
    expect(tier(b, 200)?.grant).toBe(3);
    short?.release();
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
      // Both wait on their free worker, `older` since earlier.
      clock += 1_000;
      const olderTier = tier(pools[older], 200);
      clock += 1_000;
      const youngerTier = tier(pools[younger], 200);
      expect([olderTier?.grant, youngerTier?.grant]).toEqual([1, 1]);

      // The holder gives back two permits, then has no more backlog work.
      holder?.shrinkTo(6);
      // The younger waiter's boundary comes first, yet it leaves both permits to the older.
      youngerTier?.release();
      clock += 1_000;
      const youngerNext = tier(pools[younger], 200);
      expect(youngerNext?.grant).toBe(1);
      olderTier?.release();
      clock += 1_000;
      expect(tier(pools[older], 200)?.grant).toBe(3);

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
      // Both wait on their free worker, the slow lane's since earlier.
      clock += 1_000;
      const slowTier = tier(slow, 200, "slow");
      clock += 1_000;
      const fastTier = tier(fast, 200);
      expect([slowTier?.grant, fastTier?.grant]).toEqual([1, 1]);
      expect(readMarks(dir, "reader", clock).find((m) => m.id === `slow-${first}`)?.slow).toBe(
        true,
      );

      // The holder gives back two permits, then has no more backlog work.
      holder?.shrinkTo(6);
      if (first === "slow") {
        // The older slow waiter's boundary comes first, yet it leaves both permits to the fast one.
        slowTier?.release();
        clock += 1_000;
        expect(tier(slow, 200, "slow")?.grant).toBe(1);
        fastTier?.release();
        clock += 1_000;
        expect(tier(fast, 200)?.grant).toBe(3);
      } else {
        fastTier?.release();
        clock += 1_000;
        expect(tier(fast, 200)?.grant).toBe(3);
      }
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

  test("a daemon whose free worker another lane holds waits for a permit, and runs on one", () => {
    const a = daemon("a", { hostSlots: 2 });
    const b = daemon("b", { hostSlots: 2 });
    const other = tier(b, 5);
    expect(other?.grant).toBe(2);
    const laneOne = tier(a, 1);
    expect(laneOne?.grant).toBe(1);
    // The only permit is b's: a's second lane may not start.
    expect(tier(a, 5)).toBeNull();
    other?.release();
    expect(tier(a, 5)?.grant).toBe(1);
  });

  test("a capped project's daemons together stay within its slots", () => {
    const project = { id: "/repo/p", slots: 4 };
    const p1 = daemon("p1", { hostSlots: 8, project });
    const p2 = daemon("p2", { hostSlots: 8, project });
    expect(tier(p1, 200)?.grant).toBe(4);
    // No preemption: p1 holds the project's slots, p2 runs on its free worker.
    expect(tier(p2, 200)?.grant).toBe(1);
    expect(tier(daemon("q"), 200)?.grant).toBe(4);
  });
});
