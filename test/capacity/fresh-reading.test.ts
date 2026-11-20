import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { HostCpu, TreeCpu } from "../../src/core/capacity/cores.js";
import { clearMark, type PoolMark, writeMark } from "../../src/core/capacity/marks.js";
import { createPermitPool, type PermitPool } from "../../src/core/capacity/pool.js";

/*
 * 011 C10 Size, row 011-417 (research `run-width-design.md` section 1, probe
 * `stale-cores.ts`): a backlog tier's gate counts this daemon's cores now and
 * the host's over a window at most 1 s old. The machine has 12 CPUs, 11 slots
 * and the default ceiling of 9 busy CPUs, the lab VM's numbers. This daemon's
 * tree and the host are fakes whose cores the test sets; another daemon is a mark.
 */

let root: string;
let dir: string;
const pools: PermitPool[] = [];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "squeal-fresh-reading-test-"));
  dir = join(root, "squeal-uid");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
});

afterEach(() => {
  for (const pool of pools.splice(0)) pool.close();
  rmSync(root, { recursive: true, force: true });
});

/** A reader whose next read gives `cores`, and that counts its reads. */
function fake(cores: number): TreeCpu & HostCpu & { cores: number; reads: number } {
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
  tree: TreeCpu,
  host: HostCpu,
  options: { refreshMs?: number; now?: () => number } = {},
): PermitPool {
  const pool = createPermitPool({
    dir,
    owner: { pid: process.pid, worktreeId: id },
    hostSlots: 11,
    cpus: 12,
    cores: tree,
    host,
    ...options,
  });
  pools.push(pool);
  return pool;
}

describe("a lease that ends or shrinks beside another (row 011-417, cases A to C)", () => {
  /**
   * A node:test slot holds 1 permit; a 9-wide tier starts beside it, and the
   * tree and the host read `during` cores by the next refresh. Its tier's
   * workers go; the slot's one worker stays.
   */
  async function wideTierRan(during: number) {
    const tree = fake(0);
    const host = fake(0);
    const me = daemon("me", tree, host, { refreshMs: 20 });
    const slot = me.acquire(1, "fast", 1, "backlog");
    const tier = me.acquire(9, "fast", 1, "backlog");
    expect(slot?.grant).toBe(1);
    expect(tier?.grant).toBe(8);
    tree.cores = during;
    host.cores = during;
    const reads = host.reads;
    await expect.poll(() => host.reads).toBeGreaterThan(reads);
    return { me, tree, host, tier };
  }

  test.each([9.5, 8.2, 7.2])(
    "after a tier at %s cores ends, the next tier asks at once and gets 8 permits",
    async (during) => {
      const { me, tree, host, tier } = await wideTierRan(during);
      tier?.shrinkTo(2);
      tier?.release();
      tree.cores = 1;
      host.cores = 1;
      // Before row 011-417: 0, 1 or 2, the ended tier's measured cores until the next refresh.
      expect(me.offer(9, "fast", "backlog")).toBe(8);
      expect(me.acquire(9, "fast", 1, "backlog")?.grant).toBe(8);
    },
  );

  test("a tier that returns permits counts the workers it keeps, not the window that ran them all", async () => {
    const { me, tree, host, tier } = await wideTierRan(9.5);
    tree.cores = 3;
    host.cores = 3;
    tier?.shrinkTo(2);
    // The slot's worker and the tier's 2: 3 cores of the 9, so 6 permits, not 0 at 9.5.
    expect(me.offer(9, "fast", "backlog")).toBe(6);
  });

  test("once the window that starts at the end is measured, its cores count", async () => {
    const { me, tree, host, tier } = await wideTierRan(9.5);
    tier?.release();
    // The slot's file turned heavy: 4 cores, not the 1 worker it holds.
    tree.cores = 4;
    host.cores = 4;
    const reads = host.reads;
    await expect.poll(() => host.reads).toBeGreaterThan(reads + 1);
    expect(me.offer(9, "fast", "backlog")).toBe(5);
  });
});

describe("a waiting daemon reads the host again once its reading is 1 s old (row 011-417, case E)", () => {
  test("when the other daemon's tier ends, the waiter gets the ceiling's 9, not the floor's 1", () => {
    let clock = Date.now();
    const host = fake(9.6);
    const copy2 = daemon("copy2", fake(0), host, { now: () => clock });
    // Copy 1 holds 9 background permits at 9.6 cores, and the host reads 9.6 busy.
    const copy1: PoolMark = {
      id: "copy1",
      want: 9,
      grant: 9,
      since: null,
      cores: 9.6,
      background: 9,
    };
    writeMark(dir, copy1);
    // The window opened at construction is over 1 s old at the first look; then a look each 2 s.
    clock += 1_500;
    for (let t = 0; t < 20; t += 2) {
      expect(copy2.acquire(9, "fast", 1, "backlog")).toBeNull();
      clock += 2_000;
    }
    // At t = 20 s copy 1's tier ends: its mark goes and the host reads 0.3 busy.
    clearMark(dir, "copy1");
    host.cores = 0.3;
    // Before row 011-417: 1, the floor, on the 9.6 cores of a window read 20 s before.
    expect(copy2.acquire(9, "fast", 1, "backlog")?.grant).toBe(9);
  });
});
