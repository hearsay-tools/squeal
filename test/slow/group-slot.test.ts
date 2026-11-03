import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  acquireSlowSlot,
  clearSlotWaiter,
  heldPermits,
  markSlotWaiter,
  othersWaitingForSlot,
  slotFiles,
  slowSlotHeld,
} from "../../src/core/slow/index.js";

/*
 * Spec 019 D3 (row 019-11): a group's `maxParallel` is a slot of its own.
 * The default `slow` group keeps today's files, so an older daemon and
 * `Slow slot:` read them as before; a configured group's files are
 * `group.<name>.*`. The scope is the user's, as today's slot (open question 8).
 */

let root: string;
let dir: string;
const owner = { pid: process.pid, worktreeId: "a" };

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "squeal-group-slot-test-"));
  dir = join(root, "squeal-uid");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** A worktree's waiter mark, as a release before groups names it. */
function waiterName(prefix: string, worktreeId: string): string {
  return `${prefix}${createHash("sha256").update(worktreeId).digest("hex").slice(0, 16)}`;
}

/** The files a slot of three permits and one waiter leave in `dir`, with the slot still held. */
function filesOf(group?: string): string[] {
  const slot = acquireSlowSlot({ dir, owner, permits: 3, want: 3, ...(group ? { group } : {}) });
  expect(slot?.permits).toBe(3);
  if (group === undefined) markSlotWaiter(dir, "b");
  else markSlotWaiter(dir, "b", group);
  const files = readdirSync(dir).sort();
  slot?.release();
  return files;
}

describe("a slot per check group (spec 019 D3, row 019-11)", () => {
  test("the name slow writes the same files as a slot with no name", () => {
    // Today's files, recorded before groups: SQLite keeps a held permit's journal beside it.
    const today = [
      "slow.1.lock",
      "slow.1.lock-journal",
      "slow.2.lock",
      "slow.2.lock-journal",
      "slow.lock",
      "slow.lock-journal",
      waiterName("slow.wait.", "b"),
    ];
    expect(filesOf()).toEqual(today);
    rmSync(dir, { recursive: true });
    expect(filesOf("slow")).toEqual(today);
    expect([0, 1, 2].map((i) => slotFiles().permit(i))).toEqual([
      "slow.lock",
      "slow.1.lock",
      "slow.2.lock",
    ]);
  });

  test("a configured group's files are group.<name>.<i>.lock and group.<name>.wait.*", () => {
    expect(filesOf("e2e")).toEqual([
      "group.e2e.0.lock",
      "group.e2e.0.lock-journal",
      "group.e2e.1.lock",
      "group.e2e.1.lock-journal",
      "group.e2e.2.lock",
      "group.e2e.2.lock-journal",
      waiterName("group.e2e.wait.", "b"),
    ]);
    expect(slotFiles("e2e").permit(0)).toBe("group.e2e.0.lock");
    expect(slotFiles("slow").waiterPrefix).toBe("slow.wait.");
  });

  test("two names' permits are independent", () => {
    const slow = acquireSlowSlot({ dir, owner });
    const e2e = acquireSlowSlot({ dir, owner, group: "e2e" });
    expect(slow?.permits).toBe(1);
    expect(e2e?.permits).toBe(1);
    const db = acquireSlowSlot({ dir, owner, group: "db" });
    expect(db?.permits).toBe(1);
    expect(acquireSlowSlot({ dir, owner })).toBeNull();
    expect(acquireSlowSlot({ dir, owner, group: "e2e" })).toBeNull();
    expect(slowSlotHeld({ dir })).toBe(true);
    expect(slowSlotHeld({ dir, group: "e2e" })).toBe(true);
    expect(slowSlotHeld({ dir, group: "other" })).toBe(false);
    expect(heldPermits({ dir }).map((p) => p.file)).toEqual(["slow.lock"]);
    expect(heldPermits({ dir, group: "e2e" }).map((p) => p.file)).toEqual(["group.e2e.0.lock"]);
    e2e?.release();
    expect(slowSlotHeld({ dir })).toBe(true);
    expect(slowSlotHeld({ dir, group: "e2e" })).toBe(false);
    const again = acquireSlowSlot({ dir, owner, group: "e2e" });
    expect(again?.permits).toBe(1);
    for (const slot of [slow, db, again]) slot?.release();
  });

  test("a group's waiters count for its own slot only", () => {
    mkdirSync(dir, { mode: 0o700 });
    markSlotWaiter(dir, "a", "e2e");
    expect(othersWaitingForSlot(dir, "b", Date.now(), "e2e")).toBe(true);
    expect(othersWaitingForSlot(dir, "b")).toBe(false);
    expect(othersWaitingForSlot(dir, "b", Date.now(), "e2e-2")).toBe(false);
    markSlotWaiter(dir, "a");
    expect(othersWaitingForSlot(dir, "b")).toBe(true);
    clearSlotWaiter(dir, "a", "e2e");
    expect(othersWaitingForSlot(dir, "b", Date.now(), "e2e")).toBe(false);
    expect(othersWaitingForSlot(dir, "b")).toBe(true);
  });

  test("an older daemon's waiter mark reads as today, for the slow slot only", () => {
    mkdirSync(dir, { mode: 0o700 });
    writeFileSync(join(dir, waiterName("slow.wait.", "old")), "old\n", { mode: 0o600 });
    expect(othersWaitingForSlot(dir, "b")).toBe(true);
    expect(othersWaitingForSlot(dir, "b", Date.now(), "slow")).toBe(true);
    expect(othersWaitingForSlot(dir, "b", Date.now(), "e2e")).toBe(false);
  });

  test("a name that is not a group's word is refused before any file is made", () => {
    for (const group of ["", "../x", "a.b", "a/b"]) {
      expect(() => acquireSlowSlot({ dir, owner, group })).toThrow(/check group/);
      expect(() => slotFiles(group)).toThrow(/check group/);
    }
    expect(() => readdirSync(dir)).toThrow();
  });
});
