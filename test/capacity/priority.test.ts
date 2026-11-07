import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { readMarks } from "../../src/core/capacity/marks.js";
import {
  createPermitPool,
  type PermitPool,
  type PoolLane,
  poolLaneOf,
} from "../../src/core/capacity/pool.js";
import type { CheckPriority } from "../../src/core/types/check-groups.js";

/*
 * Spec 019 D3 (row 019-11): a group's priority orders its tiers among the
 * pool's waiters. `"low"` is the slow lane's order and `"normal"` the fast
 * lane's (task 004-61), so the mark on disk is today's and an older daemon
 * reads it as before.
 */

let root: string;
let dir: string;
let clock: number;
const pools: PermitPool[] = [];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "squeal-priority-test-"));
  dir = join(root, "squeal-uid");
  clock = Date.now();
});

afterEach(() => {
  for (const pool of pools.splice(0)) pool.close();
  rmSync(root, { recursive: true, force: true });
});

function daemon(worktreeId: string): PermitPool {
  const pool = createPermitPool({
    dir,
    owner: { pid: process.pid, worktreeId },
    now: () => clock,
    hostSlots: 8,
    cores: null,
  });
  pools.push(pool);
  return pool;
}

function tier(pool: PermitPool, files: number, lane?: PoolLane) {
  const lease = pool.acquire(files, lane);
  lease?.shrinkTo(files);
  return lease;
}

/**
 * Who gets the two permits a holder gives back when an older waiter of
 * `older` and a younger one of `younger` wait, the older looking first.
 */
function served(older: PoolLane, younger: PoolLane): "older" | "younger" {
  for (const pool of pools.splice(0)) pool.close();
  const holder = tier(daemon("holder"), 200);
  expect(holder?.grant).toBe(8);
  const first = daemon("older");
  const second = daemon("younger");
  clock += 1_000;
  expect(tier(first, 200, older)).toBeNull();
  clock += 1_000;
  expect(tier(second, 200, younger)).toBeNull();
  holder?.shrinkTo(6);
  clock += 1_000;
  if (tier(first, 200, older)?.grant === 2) return "older";
  clock += 1_000;
  expect(tier(second, 200, younger)?.grant).toBe(2);
  return "younger";
}

describe("pool waiter order by a group's priority (spec 019 D3, row 019-11)", () => {
  test("low is the slow lane and normal the fast lane", () => {
    expect(poolLaneOf("low")).toBe("slow");
    expect(poolLaneOf("normal")).toBe("fast");
  });

  test("low and normal order waiters as slow and fast do", () => {
    const priorities: readonly CheckPriority[] = ["normal", "low"];
    for (const older of priorities) {
      for (const younger of priorities) {
        // Today's order, by lane, recorded first.
        const today = served(
          older === "low" ? "slow" : "fast",
          younger === "low" ? "slow" : "fast",
        );
        expect(served(poolLaneOf(older), poolLaneOf(younger))).toBe(today);
      }
    }
    // Today's order: a fast waiter is served before an older slow one; else the older first.
    expect(served("slow", "fast")).toBe("younger");
    expect(served("fast", "slow")).toBe("older");
    expect(served("slow", "slow")).toBe("older");
    expect(served("fast", "fast")).toBe("older");
  });

  test("a low waiter's mark is the slow lane's mark an older daemon reads", () => {
    const holder = tier(daemon("holder"), 200);
    expect(holder?.grant).toBe(8);
    expect(tier(daemon("low"), 200, poolLaneOf("low"))).toBeNull();
    expect(tier(daemon("normal"), 200, poolLaneOf("normal"))).toBeNull();
    const marks = readMarks(dir, "reader", clock);
    expect(marks.find((m) => m.id === "low")?.slow).toBe(true);
    expect(marks.find((m) => m.id === "normal")?.slow).toBeUndefined();
  });

  test("an older daemon's slow waiter mark reads as a low waiter", () => {
    const holder = tier(daemon("holder"), 200);
    expect(holder?.grant).toBe(8);
    // Bytes as release 0.1.395 writes them for a slow lane's waiter since an earlier time.
    const name = `pool.mark.${createHash("sha256").update("old").digest("hex").slice(0, 16)}`;
    const old = { v: 1, id: "old", want: 200, grant: 0, since: clock - 5_000, project: null };
    writeFileSync(join(dir, name), `${JSON.stringify({ ...old, slow: true })}\n`);
    holder?.shrinkTo(6);
    // A normal tier is served before it, a low one leaves it the permits.
    clock += 1_000;
    expect(tier(daemon("low"), 200, poolLaneOf("low"))).toBeNull();
    const normal = tier(daemon("normal"), 200, poolLaneOf("normal"));
    expect(normal?.grant).toBe(2);
    normal?.release();
    // Without `slow`, the older daemon's waiter is a fast lane's: the younger normal one leaves it the permits.
    writeFileSync(join(dir, name), `${JSON.stringify(old)}\n`);
    clock += 1_000;
    expect(tier(daemon("normal-2"), 200, poolLaneOf("normal"))).toBeNull();
  });
});
