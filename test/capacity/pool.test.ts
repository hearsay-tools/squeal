import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  createPermitPool,
  type PermitPool,
  type PoolCapacity,
} from "../../src/core/capacity/index.js";

/*
 * Spec 001 D11 Capacity (task 001-376): the slow slot's lock files extended
 * into one per-user pool. Each pool here is one simulated daemon; they share
 * a temporary directory, never the user's runtime directory.
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

describe("the per-user permit pool", () => {
  test("a lone daemon takes the host's slots: its free worker and every permit", () => {
    const lease = daemon("a").acquire(200);
    expect(lease?.grant).toBe(8);
    expect(lease?.permits).toBe(7);
  });

  test("a tier that wants fewer workers takes fewer permits; one file runs on the free worker", () => {
    const a = daemon("a");
    expect(a.acquire(1)?.permits).toBe(0);
    const b = daemon("b").acquire(3);
    expect(b?.grant).toBe(3);
  });

  test("fair share across daemons: the newcomer waits one tier on its free worker, then both run their share", () => {
    const a = daemon("a");
    const b = daemon("b");
    const first = a.acquire(200);
    expect(first?.grant).toBe(8);

    // No preemption: a's tier keeps its permits, b runs on its free worker and marks itself waiting.
    clock += 1_000;
    const waiting = b.acquire(200);
    expect(waiting?.grant).toBe(1);

    // At a's next tier boundary it takes no more than its share and leaves b's lack free.
    first?.release();
    clock += 1_000;
    const second = a.acquire(200);
    expect(second?.grant).toBe(4);

    waiting?.release();
    clock += 1_000;
    expect(b.acquire(200)?.grant).toBe(4);
  });

  test("slots one daemon cannot use go to the others", () => {
    const a = daemon("a");
    const b = daemon("b");
    const c = daemon("c");
    expect(c.acquire(2)?.grant).toBe(2);
    // c wants only 2: b, alone beside it, takes the other 6.
    const wide = b.acquire(200);
    expect(wide?.grant).toBe(6);
    // a's share of the 6 is 3; one permit is free, so it waits for the rest.
    clock += 1_000;
    const short = a.acquire(200);
    expect(short?.grant).toBe(2);
    // b's next boundary leaves a its lack; then a runs its share.
    wide?.release();
    clock += 1_000;
    expect(b.acquire(200)?.grant).toBe(3);
    short?.release();
    clock += 1_000;
    expect(a.acquire(200)?.grant).toBe(3);
  });

  test("the longest waiter is served first, whichever reaches its boundary first", () => {
    for (const [older, younger] of [
      ["b", "c"],
      ["c", "b"],
    ] as const) {
      const a = daemon(`a-${older}`);
      const pools = { b: daemon(`b-${older}`), c: daemon(`c-${older}`) };
      const holder = a.acquire(200);
      expect(holder?.grant).toBe(8);
      // Both wait on their free worker, `older` since earlier.
      clock += 1_000;
      const olderTier = pools[older].acquire(200);
      clock += 1_000;
      const youngerTier = pools[younger].acquire(200);
      expect([olderTier?.grant, youngerTier?.grant]).toEqual([1, 1]);

      // The holder gives back two permits, then has no more backlog work.
      holder?.shrinkTo(6);
      // The younger waiter's boundary comes first, yet it leaves both permits to the older.
      youngerTier?.release();
      clock += 1_000;
      const youngerNext = pools[younger].acquire(200);
      expect(youngerNext?.grant).toBe(1);
      olderTier?.release();
      clock += 1_000;
      expect(pools[older].acquire(200)?.grant).toBe(3);

      for (const pool of [a, pools.b, pools.c]) pool.close();
    }
  });

  test("a daemon whose free worker another lane holds waits for a permit, and runs on one", () => {
    const a = daemon("a", { hostSlots: 2 });
    const b = daemon("b", { hostSlots: 2 });
    const other = b.acquire(5);
    expect(other?.grant).toBe(2);
    const laneOne = a.acquire(1);
    expect(laneOne?.grant).toBe(1);
    // The only permit is b's: a's second lane may not start.
    expect(a.acquire(5)).toBeNull();
    other?.release();
    expect(a.acquire(5)?.grant).toBe(1);
  });

  test("a capped project's daemons together stay within its slots", () => {
    const project = { id: "/repo/p", slots: 4 };
    const p1 = daemon("p1", { hostSlots: 8, project });
    const p2 = daemon("p2", { hostSlots: 8, project });
    expect(p1.acquire(200)?.grant).toBe(4);
    // No preemption: p1 holds the project's slots, p2 runs on its free worker.
    expect(p2.acquire(200)?.grant).toBe(1);
    expect(daemon("q").acquire(200)?.grant).toBe(4);
  });
});
