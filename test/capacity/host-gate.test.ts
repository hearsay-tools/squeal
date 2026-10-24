import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  createHostCpu,
  gatedPermits,
  type HostCpu,
  type TreeCpu,
} from "../../src/core/capacity/cores.js";
import {
  createPermitPool,
  HOST_WINDOW_MIN_MS,
  type PermitPool,
  type PoolMark,
  writeMark,
} from "../../src/core/capacity/index.js";
import { SLOT_WAITER_FRESH_MS } from "../../src/core/slow/index.js";

/*
 * 011 C10 Size as amended 2026-10-24 (row 011-182): for a backlog tier, the
 * CPU compared with the slots is the larger of the fresh marks' CPU and the
 * host's busy cores over the same window, so on a host busy with other work
 * a backlog tier takes a permit only while the grants are below half the
 * slots. A checkpoint's tier keeps the marks' CPU alone, and so does a
 * daemon that cannot read the host. The other daemons here are marks; this
 * daemon's tree and the host are fakes whose cores the test sets.
 */

let root: string;
let dir: string;
const pools: PermitPool[] = [];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "squeal-host-gate-test-"));
  dir = join(root, "squeal-uid");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
});

afterEach(() => {
  for (const pool of pools.splice(0)) pool.close();
  rmSync(root, { recursive: true, force: true });
});

/** A reader whose next read gives `cores`, and that counts its reads. */
function fake(cores: number | null): TreeCpu & HostCpu & { cores: number | null; reads: number } {
  return {
    cores,
    reads: 0,
    read() {
      this.reads++;
      return this.cores;
    },
    reset() {},
  };
}

function daemon(
  id: string,
  host: HostCpu | null,
  options: { tree?: TreeCpu; refreshMs?: number; now?: () => number } = {},
): PermitPool {
  const pool = createPermitPool({
    dir,
    owner: { pid: process.pid, worktreeId: id },
    hostSlots: 12,
    cores: options.tree ?? fake(0),
    host,
    ...(options.refreshMs === undefined ? {} : { refreshMs: options.refreshMs }),
    ...(options.now === undefined ? {} : { now: options.now }),
  });
  pools.push(pool);
  return pool;
}

/** Other daemons' marks: each `[grant, cores]`, wanting what they hold. */
function others(...marks: readonly (readonly [number, number])[]): void {
  marks.forEach(([grant, cores], i) => {
    const mark: PoolMark = { id: `other-${i}`, want: grant, grant, since: null, cores };
    writeMark(dir, mark);
  });
}

describe("the host's busy cores (row 011-182)", () => {
  /** Writes the fixture's `/proc/stat`: user, nice, system, idle, iowait, irq, softirq, steal ticks. */
  function stat(ticks: readonly number[]): void {
    mkdirSync(join(root, "proc"), { recursive: true });
    writeFileSync(join(root, "proc", "stat"), `cpu  ${ticks.join(" ")} 0 0\ncpu0 1 1 1 1\n`);
  }

  test("are the growth of every CPU time but idle and iowait over the window, nice included, in cores", () => {
    let clock = 0;
    stat([1_000, 500, 300, 9_000, 100, 10, 10, 0]);
    const host = createHostCpu({ root, now: () => clock });
    expect(host?.read()).toBeNull();
    // Over 2 s at 100 ticks a second: 400 user, 1,000 nice (Squeal's tests), 200 system, 50 irq
    // and 50 steal are busy; 1,000 idle and 300 iowait are not.
    clock = 2_000;
    stat([1_400, 1_500, 500, 10_000, 400, 60, 10, 50]);
    expect(host?.read()).toBeCloseTo(8.5);
  });

  test("cannot be read without /proc/stat", () => {
    expect(createHostCpu({ root })).toBeNull();
  });
});

describe("gatedPermits with the host's busy cores (row 011-182)", () => {
  const own = { cores: 0, grant: 0 };

  test("a busy host above the slots lets a backlog tier take permits only to half of them", () => {
    expect(gatedPermits([], own, 12, 10, null)).toBe(10);
    expect(gatedPermits([], own, 12, 10, 23.9)).toBe(6);
  });

  test("busy cores below the slots count one core for each new permit, as the marks' do", () => {
    // 4 busy: 8 permits bring the cores to the slots.
    expect(gatedPermits([], own, 12, 10, 4)).toBe(8);
    const marks: PoolMark[] = [{ id: "a", want: 50, grant: 2, since: null, cores: 4 }];
    expect(gatedPermits(marks, own, 12, 10, null)).toBe(8);
  });

  test("the larger of the marks' cores and the busy cores counts, never their sum", () => {
    const marks: PoolMark[] = [{ id: "a", want: 50, grant: 2, since: null, cores: 4 }];
    // Squeal's own tests are in both: 4 busy cores beside a mark of 4 cores leave 8 permits.
    expect(gatedPermits(marks, own, 12, 10, 4)).toBe(8);
    // Marks over the slots hold the gate whatever the host reads.
    const full: PoolMark[] = [{ id: "a", want: 50, grant: 2, since: null, cores: 14 }];
    expect(gatedPermits(full, own, 12, 10, 1)).toBe(4);
  });
});

describe("the pool's gate on a busy host (row 011-182)", () => {
  test("a busy host shrinks a backlog acquire and offer to half the slots, not a checkpoint's", () => {
    const me = daemon("me", fake(23.9));
    expect(me.offer(10, "fast", "backlog")).toBe(6);
    expect(me.offer(10)).toBe(10);
    expect(me.offer(10, "fast", "checkpoint")).toBe(10);
    const checkpoint = me.acquire(10, "fast", 1, "checkpoint");
    expect(checkpoint?.grant).toBe(10);
    checkpoint?.release();
    expect(me.acquire(10, "fast", 1, "backlog")?.grant).toBe(6);
  });

  test("a host busy at the slots shrinks a backlog acquire below half of them and leaves a checkpoint's as today", () => {
    // Another daemon holds 2 permits on 2 cores; the host's 12 busy cores are the slots.
    others([2, 2]);
    const today = daemon("today", null).acquire(10, "fast", 1, "checkpoint")?.grant;
    for (const pool of pools.splice(0)) pool.close();
    expect(today).toBe(10);
    expect(daemon("me", fake(12)).acquire(10, "fast", 1, "checkpoint")?.grant).toBe(today);
    for (const pool of pools.splice(0)) pool.close();
    // At the slots no permit passes on cores: only grants below half, 6, so 4 beside the 2 held.
    expect(daemon("me", fake(12)).acquire(10, "fast", 1, "backlog")?.grant).toBe(4);
  });

  test("a backlog tier grows while the grants are below half the slots, beside other daemons' marks", () => {
    // Two daemons hold 3 permits on few cores: the gate saw about 4 cores (011-139 finding 3).
    others([2, 1], [1, 1]);
    expect(daemon("me", fake(23.9)).acquire(10, "fast", 1, "backlog")?.grant).toBe(3);
    for (const pool of pools.splice(0)) pool.close();
    expect(daemon("me", fake(null)).acquire(10, "fast", 1, "backlog")?.grant).toBe(9);
  });

  test("where the host cannot be read, a backlog tier keeps the marks' gate", () => {
    expect(daemon("blind", null).acquire(10, "fast", 1, "backlog")?.grant).toBe(10);
    for (const pool of pools.splice(0)) pool.close();
    expect(daemon("unread", fake(null)).acquire(10, "fast", 1, "backlog")?.grant).toBe(10);
  });

  test("on a host where Squeal is the load, a tier of its own that ended counts no more", async () => {
    const tree = fake(0);
    const host = fake(0.5);
    const me = daemon("me", host, { tree, refreshMs: 20 });
    const first = me.acquire(10, "fast", 1, "backlog");
    expect(first?.grant).toBe(10);
    // Its ten workers use 10.5 of the host's 11 busy cores by the next refresh.
    tree.cores = 10.5;
    host.cores = 11;
    const reads = host.reads;
    await expect.poll(() => host.reads).toBeGreaterThan(reads);
    first?.release();
    // The host's 11 cores are mostly the tier that ended: 0.5 cores beyond it, so the next
    // backlog tier takes its 10 again, not the half that 11 busy cores would leave.
    expect(me.acquire(10, "fast", 1, "backlog")?.grant).toBe(10);
  });

  test("a window older than a mark's freshness is read again, once the last read is a second old", () => {
    let clock = Date.now();
    const host = fake(1);
    const me = daemon("me", host, { now: () => clock });
    expect(me.offer(10, "fast", "backlog")).toBe(10);
    host.cores = 23.9;
    // Within the window's freshness the gate keeps the last window's cores.
    clock += SLOT_WAITER_FRESH_MS - 1;
    expect(me.offer(10, "fast", "backlog")).toBe(10);
    clock += 1;
    expect(me.offer(10, "fast", "backlog")).toBe(6);
    // A checkpoint's offer reads nothing.
    clock += SLOT_WAITER_FRESH_MS;
    const reads = host.reads;
    me.offer(10);
    expect(host.reads).toBe(reads);
    // A read that gives nothing leaves no window, and the next is a second later at the soonest.
    host.cores = null;
    expect(me.offer(10, "fast", "backlog")).toBe(10);
    expect(host.reads).toBe(reads + 1);
    host.cores = 23.9;
    clock += HOST_WINDOW_MIN_MS - 1;
    expect(me.offer(10, "fast", "backlog")).toBe(10);
    expect(host.reads).toBe(reads + 1);
    clock += 1;
    expect(me.offer(10, "fast", "backlog")).toBe(6);
  });

  test("a daemon's own running tier counts beside what the host used beyond its tree", async () => {
    const tree = fake(0);
    const host = fake(0);
    const me = daemon("me", host, { tree, refreshMs: 20 });
    const first = me.acquire(4, "fast", 1, "backlog");
    expect(first?.grant).toBe(4);
    // Its 4 workers use 4 cores, and other work 6 more: 10 of the 12 slots.
    tree.cores = 4;
    host.cores = 10;
    const reads = host.reads;
    await expect.poll(() => host.reads).toBeGreaterThan(reads);
    // Two permits bring the cores to the slots; with its own 4 left out it would take 6.
    expect(me.acquire(8, "fast", 1, "backlog")?.grant).toBe(2);
  });
});
