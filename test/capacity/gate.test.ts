import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { TreeCpu } from "../../src/core/capacity/cores.js";
import {
  createPermitPool,
  type PermitPool,
  type PoolMark,
  readMarks,
  writeMark,
} from "../../src/core/capacity/index.js";

/*
 * 011 C10 Size as amended 2026-10-21 (design 011-83 Q3 (a), row 011-98):
 * each permit a daemon takes within its share needs the fresh marks' CPU,
 * its own included, below the slots, or their grants below half the slots.
 * A permit not yet measured counts one core. An edit's tier writes a mark
 * with no backlog demand and the CPU its tree uses, and never waits. The
 * other daemons here are marks written as theirs would be; this daemon's
 * tree is a fake whose cores the test sets.
 */

let root: string;
let dir: string;
const pools: PermitPool[] = [];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "squeal-gate-test-"));
  dir = join(root, "squeal-uid");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
});

afterEach(() => {
  for (const pool of pools.splice(0)) pool.close();
  rmSync(root, { recursive: true, force: true });
});

/** A tree whose next read gives `cores`. */
function fakeTree(cores: number | null = null): TreeCpu & { cores: number | null } {
  return {
    cores,
    read() {
      return this.cores;
    },
    reset() {},
  };
}

function daemon(
  id: string,
  cores: TreeCpu | null = fakeTree(),
  refreshMs?: number,
  hostSlots = 12,
): PermitPool {
  const pool = createPermitPool({
    dir,
    owner: { pid: process.pid, worktreeId: id },
    hostSlots,
    cores,
    ...(refreshMs === undefined ? {} : { refreshMs }),
  });
  pools.push(pool);
  return pool;
}

/** Other daemons' marks: each `[grant, cores]`, wanting more than they hold. */
function others(...marks: readonly (readonly [number, number | undefined])[]): void {
  marks.forEach(([grant, cores], i) => {
    const mark: PoolMark = { id: `other-${i}`, want: 50, grant, since: null };
    writeMark(dir, cores === undefined ? mark : { ...mark, cores });
  });
}

const markOf = (id: string) => readMarks(dir, "reader", Date.now()).find((m) => m.id === id);

describe("the pool's CPU gate (row 011-98)", () => {
  test("marks over the slots in cores with half the slots granted take no permit; below half they take one, to half", () => {
    others([4, 8], [3, 5]);
    const me = daemon("me");
    expect(me.acquire(10)).toBeNull();
    // A daemon the gate holds back waits, marked.
    expect(markOf("me")?.since).not.toBeNull();
    me.close();
    others([3, 8], [2, 5]);
    const lease = daemon("me-again").acquire(10);
    expect(lease?.grant).toBe(1);
  });

  test("below the slots in cores a daemon takes its share, each new permit one core until measured", () => {
    others([4, 3], [3, 2]);
    expect(daemon("me").acquire(10)?.grant).toBe(4);
    for (const pool of pools.splice(0)) pool.close();
    // 10 cores: two more permits bring them to the slots.
    others([4, 6], [3, 4]);
    expect(daemon("me").acquire(10)?.grant).toBe(2);
  });

  test("a mark without cores counts its grant, and a daemon that cannot read its tree counts processes only", () => {
    others([4, undefined], [3, undefined]);
    expect(daemon("me").acquire(10)?.grant).toBe(4);
    for (const pool of pools.splice(0)) pool.close();
    others([4, 8], [3, 5]);
    expect(daemon("blind", null).acquire(10)?.grant).toBe(4);
  });

  test("a daemon's own measured CPU counts against its next permit", async () => {
    const tree = fakeTree();
    const me = daemon("me", tree, 20);
    const first = me.acquire(6);
    first?.shrinkTo(6);
    expect(first?.grant).toBe(6);
    expect(markOf("me")?.cores).toBe(6);
    // Its six workers and what they start use 13 cores by the next refresh.
    tree.cores = 13;
    await expect.poll(() => markOf("me")?.cores).toBe(13);
    expect(me.acquire(5)).toBeNull();
    tree.cores = 3;
    await expect.poll(() => markOf("me")?.cores).toBe(3);
    expect(me.acquire(5)?.grant).toBe(5);
  });

  test("an edit's tier writes a mark with no backlog demand and its CPU, takes nothing, and clears it at its end", async () => {
    const tree = fakeTree();
    const me = daemon("me", tree, 20);
    const end = me.running(3);
    // Until its first measurement it counts one core per worker.
    expect(markOf("me")).toMatchObject({ want: 0, grant: 0, since: null, cores: 3 });
    tree.cores = 9;
    await expect.poll(() => markOf("me")?.cores).toBe(9);
    // No backlog demand, but its CPU: another daemon's backlog tier takes half the slots, not 12.
    expect(daemon("other").acquire(50)?.grant).toBe(6);
    end();
    end();
    expect(markOf("me")).toBeUndefined();
  });

  test("an edit's mark beside a lease keeps the lease's demand, and the lease's end leaves the edit's", () => {
    const me = daemon("me");
    const lease = me.acquire(4);
    lease?.shrinkTo(4);
    const end = me.running(2);
    expect(markOf("me")).toMatchObject({ want: 4, grant: 4, cores: 6 });
    lease?.release();
    expect(markOf("me")).toMatchObject({ want: 0, grant: 0, cores: 2 });
    end();
    expect(markOf("me")).toBeUndefined();
  });
});
