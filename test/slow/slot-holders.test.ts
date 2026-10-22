import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { acquireSlowSlot, heldPermits, slowSlotHeld } from "../../src/core/slow/index.js";
import type { WorktreeId } from "../../src/core/types/index.js";

/*
 * Row 011-58 (gh-58; spec 004 D2): every held permit of the slot names the
 * holder its lock file records, read without a lock, since the holder's
 * exclusive lock keeps every other reader out. D2 lets several daemons hold
 * permits at once.
 */

let root: string;
let dir: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "squeal-slot-holders-test-"));
  dir = join(root, "squeal-uid");
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

const owner = (worktreeId: string) => ({ pid: process.pid, worktreeId: worktreeId as WorktreeId });

describe("the slot's held permits and their holders (011-58)", () => {
  test("names each held permit's holder, and leaves a free one out", () => {
    const before = Date.now();
    const a = acquireSlowSlot({ dir, owner: owner("wt-a"), permits: 3, want: 2 });
    const b = acquireSlowSlot({ dir, owner: owner("wt-b"), permits: 3, want: 1 });
    a?.shrinkTo(1);

    const held = heldPermits({ dir, permits: 3 });

    expect(held.map((p) => p.file)).toEqual(["slow.lock", "slow.2.lock"]);
    expect(held.map((p) => p.record)).toEqual([
      { kind: "holder", pid: process.pid, worktreeId: "wt-a", since: expect.any(Number) },
      { kind: "holder", pid: process.pid, worktreeId: "wt-b", since: expect.any(Number) },
    ]);
    for (const p of held) {
      if (p.record.kind !== "holder") throw new Error("a holder is recorded");
      expect(p.record.since).toBeGreaterThanOrEqual(before);
    }
    // The read takes no lock: the holders still hold, and nothing else can take them.
    expect(slowSlotHeld({ dir, permits: 1 })).toBe(true);
    expect(acquireSlowSlot({ dir, owner: owner("wt-c"), permits: 3, want: 3 })?.permits).toBe(1);
    a?.release();
    b?.release();
  });

  test("reads the holder in place, through SQLite's immutable URI, and writes no copy (011-102)", () => {
    const slot = acquireSlowSlot({ dir, owner: owner("wt-a"), permits: 1 });
    // No temporary directory to copy the permit file into: the read takes its bytes in place.
    vi.stubEnv("TMPDIR", join(root, "no-such-dir"));

    const held = heldPermits({ dir, permits: 1 });
    slot?.release();

    expect(held).toEqual([
      {
        file: "slow.lock",
        record: { kind: "holder", pid: process.pid, worktreeId: "wt-a", since: expect.any(Number) },
      },
    ]);
  });

  test("a missing directory or permit file holds none, and none is created", () => {
    expect(heldPermits({ dir, permits: 4 })).toEqual([]);
    const slot = acquireSlowSlot({ dir, owner: owner("wt-a"), permits: 1 });
    slot?.release();

    expect(heldPermits({ dir, permits: 4 })).toEqual([]);
    expect(acquireSlowSlot({ dir, owner: owner("wt-b"), permits: 4, want: 4 })?.permits).toBe(4);
  });

  test("a held permit with no holder row, a malformed one, or no database, says so", () => {
    acquireSlowSlot({ dir, owner: owner("wt-a"), permits: 2, want: 2 })?.release();
    // Held by connections that wrote no holder, or a malformed one, as no release writes.
    const hold = (file: string, sql: string) => {
      const db = new DatabaseSync(join(dir, file));
      db.exec("PRAGMA locking_mode = EXCLUSIVE");
      db.exec("BEGIN EXCLUSIVE");
      db.exec(sql);
      db.exec("COMMIT");
      return db;
    };
    const bare = hold("slow.lock", "DELETE FROM holder");
    const odd = hold("slow.1.lock", "UPDATE holder SET pid = 'not a pid'");
    writeFileSync(join(dir, "slow.2.lock"), "not a database, as no permit file should read");

    const held = heldPermits({ dir, permits: 3 });
    bare.close();
    odd.close();

    expect(held).toEqual([
      { file: "slow.lock", record: { kind: "missing" } },
      { file: "slow.1.lock", record: { kind: "unreadable" } },
      { file: "slow.2.lock", record: { kind: "unreadable" } },
    ]);
  });
});
