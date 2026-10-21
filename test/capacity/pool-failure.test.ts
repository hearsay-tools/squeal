import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  createPermitPool,
  type PermitPool,
  poolPermitFile,
} from "../../src/core/capacity/index.js";
import { TierCapacity, WAIT_FOR_CAPACITY } from "../../src/core/scheduler/capacity.js";
import { takePermit } from "../../src/core/slow/index.js";
import type { WorktreeId } from "../../src/core/types/index.js";

/*
 * Review 001-384, B2: a mark that cannot be written must never strand a
 * lease. The daemon's `pool.mark.<hash>.tmp` is made a directory, so every
 * mark write fails with EISDIR while the permits themselves stay takeable.
 * Each failed acquisition returns what it took, a shrink and a release never
 * throw, and once the directory is usable again the daemon takes its share.
 */

let root: string;
let dir: string;
const pools: { close(): void }[] = [];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "squeal-pool-failure-"));
  dir = join(root, "squeal-uid");
});

afterEach(() => {
  for (const pool of pools.splice(0)) pool.close();
  rmSync(root, { recursive: true, force: true });
});

const ME = "me" as WorktreeId;

function obstructMark(): () => void {
  const name = createHash("sha256").update(ME).digest("hex").slice(0, 16);
  const tmp = join(dir, `pool.mark.${name}.tmp`);
  mkdirSync(tmp, { recursive: true, mode: 0o700 });
  return () => rmSync(tmp, { recursive: true, force: true });
}

function capacity(notes: string[]): TierCapacity {
  const tiers = new TierCapacity({ dir, hostSlots: 2 }, ME, (note) => notes.push(note));
  pools.push(tiers);
  return tiers;
}

/** How many of the pool's two permits (hostSlots 2, row 011-96) nothing holds. */
function freePermits(): number {
  let free = 0;
  for (const i of [0, 1]) {
    const db = takePermit(join(dir, poolPermitFile(i)), { pid: process.pid, worktreeId: "probe" });
    db?.close();
    if (db !== null) free++;
  }
  return free;
}

function competitor(): PermitPool {
  const pool = createPermitPool({
    dir,
    owner: { pid: process.pid, worktreeId: "other" },
    hostSlots: 2,
  });
  pools.push(pool);
  return pool;
}

describe("a pool whose mark cannot be written", () => {
  test("the tier runs ungranted with one note, holds nothing, and the next tier takes its share", () => {
    const notes: string[] = [];
    const tiers = capacity(notes);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const unblock = obstructMark();
    expect(tiers.take(200)).toBeNull();
    expect(tiers.take(200)).toBeNull();
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatch(/EISDIR.*tiers run without a grant/);
    // Nothing leaked: another daemon takes both permits.
    const other = competitor().acquire(200);
    expect(other?.grant).toBe(2);
    other?.release();

    unblock();
    const lease = tiers.take(200);
    expect(lease).not.toBe(WAIT_FOR_CAPACITY);
    expect(lease === null || lease === WAIT_FOR_CAPACITY ? 0 : lease.grant).toBe(2);
  });

  test("a shrink and a release that cannot write the mark never throw and return the permits", () => {
    const tiers = capacity([]);
    const lease = tiers.take(200);
    if (lease === null || lease === WAIT_FOR_CAPACITY) throw new Error("expected a lease");
    expect(lease.grant).toBe(2);
    const unblock = obstructMark();
    expect(() => lease.shrinkTo(1)).not.toThrow();
    expect(lease.grant).toBe(1);
    expect(freePermits()).toBe(1);
    expect(() => lease.release()).not.toThrow();
    unblock();
  });

  test("a failure while another lane holds leaves that lane's lease releasable and nothing else held", () => {
    const tiers = capacity([]);
    const laneOne = tiers.take(1);
    if (laneOne === null || laneOne === WAIT_FOR_CAPACITY) throw new Error("expected a lease");
    const unblock = obstructMark();
    // Lane two would take the other permit; the mark fails, so it runs ungranted and holds none.
    expect(tiers.take(200)).toBeNull();
    expect(freePermits()).toBe(1);
    unblock();
    laneOne.release();
    const next = tiers.take(200);
    expect(next === null || next === WAIT_FOR_CAPACITY ? 0 : next.grant).toBe(2);
    // Close returns every lock: the competitor then takes the whole pool.
    tiers.close();
    expect(competitor().acquire(200)?.grant).toBe(2);
  });
});
