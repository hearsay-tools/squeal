import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { backlogShareSlots } from "../../src/core/capacity/background.js";
import type { TreeCpu } from "../../src/core/capacity/cores.js";
import { readMarks } from "../../src/core/capacity/marks.js";
import { createPermitPool, type PermitPool } from "../../src/core/capacity/pool.js";
import { createHostAdmission } from "../../src/core/runner-host/remote/admission.js";

/*
 * Review 0.1.584 B1 (row 011-424): a backlog tier's fair shares divide the
 * workers the ceiling admits, raised to the most fewest workers a demand's
 * tier runs (row 011-97), at most the slots. Without the raise, a ceiling
 * below a tier's fewest workers left a share below them: the pool's floor
 * (spec 021 D18), which serves the oldest waiter its fewest workers while
 * no background tier runs, was refused at every look. The machine: 4 CPUs,
 * 3 slots; an idle tree, no host reading.
 */

let root: string;
let dir: string;
const closing: { close(): void }[] = [];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "squeal-least-floor-test-"));
  dir = join(root, "squeal-uid");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
});

afterEach(() => {
  for (const pool of closing.splice(0)) pool.close();
  rmSync(root, { recursive: true, force: true });
});

const tree: TreeCpu = { read: () => 0, reset() {} };

/** `backgroundShare` of 4 CPUs is the ceiling: 0 → 0, 0.1875 → 0.75, 0.25 → 1. */
function options(id: string, backgroundShare: number) {
  return {
    dir,
    owner: { pid: process.pid, worktreeId: id },
    hostSlots: 3,
    cpus: 4,
    backgroundShare,
    cores: tree,
    host: null,
  };
}

function daemon(id: string, backgroundShare: number): PermitPool {
  const pool = createPermitPool(options(id, backgroundShare));
  closing.push(pool);
  return pool;
}

describe("a tier's fewest workers on a ceiling below them (review 0.1.584 B1)", () => {
  test.each([0, 0.1875, 0.25])(
    "an idle lone daemon at share %s starts a tier of least 2 at 2",
    (share) => {
      expect(daemon("me", share).acquire(10, "fast", 2, "backlog")?.grant).toBe(2);
    },
  );

  test("the oldest waiter gets its 2 before a younger one; the younger waits behind it", () => {
    const share = 0.25;
    const holder = daemon("holder", share);
    const held = holder.acquire(1, "fast", 1, "backlog");
    expect(held?.grant).toBe(1);
    const older = daemon("older", share);
    // A background tier runs: no floor, and the ceiling (1) is full.
    expect(older.acquire(10, "fast", 2, "backlog")).toBeNull();
    held?.release();
    const younger = daemon("younger", share);
    // The older waiter is served first: the younger's share is 0.
    expect(younger.acquire(10, "fast", 1, "backlog")).toBeNull();
    expect(older.acquire(10, "fast", 2, "backlog")?.grant).toBe(2);
    expect(readMarks(dir, "reader", Date.now()).find((m) => m.id === "younger")).toMatchObject({
      grant: 0,
    });
  });

  test("the remote runner host's admission starts the tier too", () => {
    const admission = createHostAdmission(() => createPermitPool(options("remote", 0.25)));
    closing.push(admission);
    expect(admission.admit({ want: 10, least: 2 }).grant).toBe(2);
  });

  test("the raise stops at the slots, and leaves the 5 + 4 total alone", () => {
    expect(backlogShareSlots(1, 3, 2)).toBe(2);
    expect(backlogShareSlots(0, 3, 8)).toBe(3);
    expect(backlogShareSlots(9, 11, 2)).toBe(9);
    expect(backlogShareSlots(7.5, 9)).toBe(8);
  });
});

/*
 * Row 026-33 (#292): a tier's fewest workers above what the pool can ever
 * grant, its slots or the project's, never deadlocks the look. A 4-CPU
 * machine has 3 slots; a 4-file node:test tier asked `least` 4 there and
 * was refused at every look, with no refusal line, until the daemon ended.
 */
describe("a tier's fewest workers above the pool's most (row 026-33, #292)", () => {
  test("a 3-slot pool grants 3 to a tier of least 4", () => {
    expect(daemon("me", 0.75).acquire(4, "fast", 4, "backlog")?.grant).toBe(3);
  });

  test("a project of 2 slots on an 8-slot pool grants 2 to a tier of least 4", () => {
    const pool = createPermitPool({
      ...options("me", 0.75),
      hostSlots: 8,
      cpus: 8,
      project: { id: "p", slots: 2 },
    });
    closing.push(pool);
    expect(pool.acquire(4, "fast", 4, "backlog")?.grant).toBe(2);
  });

  test("a checkpoint tier of least 4 on a 3-slot pool gets 3", () => {
    expect(daemon("me", 0.75).acquire(4, "fast", 4, "checkpoint")?.grant).toBe(3);
  });

  test("the remote runner host's admission on 4 CPUs and 3 slots grants 3 to a tier of least 4", () => {
    const admission = createHostAdmission(() => createPermitPool(options("remote", 0.75)));
    closing.push(admission);
    expect(admission.admit({ want: 4, least: 4 }).grant).toBe(3);
  });

  test("the clamped tier still waits behind a held permit, and the mark states the clamped floor", () => {
    const holder = daemon("holder", 0.75);
    expect(holder.acquire(1, "fast", 1, "checkpoint")?.grant).toBe(1);
    const me = daemon("me", 0.75);
    // 2 of 3 permits free: fewer than the clamped floor, 3.
    expect(me.acquire(4, "fast", 4, "checkpoint")).toBeNull();
    expect(readMarks(dir, "reader", Date.now()).find((m) => m.id === "me")).toMatchObject({
      grant: 0,
      least: 3,
    });
  });
});
