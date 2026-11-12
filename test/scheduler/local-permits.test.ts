import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPermitPool, type PoolLease, poolPermitFile } from "../../src/core/capacity/pool.js";
import { TierCapacity, WAIT_FOR_CAPACITY } from "../../src/core/scheduler/capacity.js";
import { TierPermits } from "../../src/core/scheduler/local-permits.js";
import { takePermit } from "../../src/core/slow/slot.js";

/*
 * Spec 021 D18, last bullet (row 021-21; the coordinator, request
 * 66d23a73): a background tier's run on another machine gives its local
 * permits back; one that comes back to run here waits for them again as a
 * backlog tier waits, and a cancel ends that wait with nothing taken.
 */

let root: string;
let dir: string;
const closing: { close(): void }[] = [];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "squeal-local-permits-"));
  dir = join(root, "squeal-uid");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
});

afterEach(() => {
  for (const item of closing.splice(0)) item.close();
  rmSync(root, { recursive: true, force: true });
});

/** A daemon's capacity over the pool of 4 permits, and its tier's grant of all 4. */
function tier(): { capacity: TierCapacity; lease: PoolLease } {
  const capacity = new TierCapacity({ dir, hostSlots: 4, host: null }, "daemon", () => {});
  closing.push(capacity);
  const lease = capacity.take(4, "fast", 1, "backlog");
  if (lease === null || lease === WAIT_FOR_CAPACITY) throw new Error("no grant");
  return { capacity, lease };
}

/** Another process that takes every free permit, without a CPU gate. */
function holder(): { take(): number; release(): void } {
  const pool = createPermitPool({
    dir,
    owner: { pid: process.pid, worktreeId: "holder" },
    hostSlots: 4,
    cores: null,
  });
  closing.push(pool);
  let lease: PoolLease | null = null;
  return {
    take: () => {
      lease = pool.acquire(4, "fast", 1, "checkpoint");
      return lease?.grant ?? 0;
    },
    release: () => lease?.release(),
  };
}

describe("a background tier's local permits (spec 021 D18, row 021-21)", () => {
  it("gives them back, and takes them again once free, waiting while none is", async () => {
    const { capacity, lease } = tier();
    const permits = new TierPermits(capacity, lease, 1, 10);
    // Not given back: its grant, at once.
    expect(await permits.back()).toBe(4);
    expect(permits.lease).toBe(lease);
    permits.away();
    expect(permits.lease).toBeNull();
    const other = holder();
    expect(other.take()).toBe(4);
    let workers: number | null | undefined;
    void permits.back().then((granted) => {
      workers = granted;
    });
    await sleep(100);
    expect(workers).toBeUndefined();
    other.release();
    await until(() => workers !== undefined);
    expect(workers).toBeGreaterThanOrEqual(1);
    expect(workers).toBeLessThanOrEqual(4);
    expect(permits.lease?.grant).toBe(workers);
    // The run ended: what it took again goes back.
    permits.release();
    expect(locked()).toBe(0);
  });

  it("ends the wait on a cancel with nothing taken", async () => {
    const { capacity, lease } = tier();
    const permits = new TierPermits(capacity, lease, 1, 60_000);
    permits.away();
    const other = holder();
    expect(other.take()).toBe(4);
    const cancel = new AbortController();
    const waiting = permits.back(cancel.signal);
    await sleep(20);
    const at = Date.now();
    cancel.abort();
    expect(await waiting).toBeNull();
    expect(Date.now() - at).toBeLessThan(1_000);
    expect(permits.lease).toBeNull();
    other.release();
    // Nothing is held; the cancelled look stays a waiter's until it is forgotten (30 s).
    expect(locked()).toBe(0);
  });

  it("leaves the tier's own grant to the tier's end", () => {
    const { capacity, lease } = tier();
    const permits = new TierPermits(capacity, lease, 1);
    permits.release();
    expect(locked()).toBe(4);
    lease.release();
    expect(locked()).toBe(0);
  });

  it("runs at the grant it gave back when the pool fails, as a tier runs ungranted", async () => {
    const failing = { take: () => null } as unknown as TierCapacity;
    const lease: PoolLease = { grant: 3, permits: 3, shrinkTo() {}, release() {} };
    const permits = new TierPermits(failing, lease, 1, 10);
    permits.away();
    expect(await permits.back()).toBe(3);
  });
});

/** How many of the 4 permit files a holder locks now. */
function locked(): number {
  let count = 0;
  for (let i = 0; i < 4; i++) {
    const db = takePermit(join(dir, poolPermitFile(i)), {
      pid: process.pid,
      worktreeId: "counter",
    });
    if (db === null) count++;
    else db.close();
  }
  return count;
}

async function until(done: () => boolean, ms = 10_000): Promise<void> {
  const end = Date.now() + ms;
  while (!done()) {
    if (Date.now() > end) throw new Error("until: not met");
    await sleep(10);
  }
}
