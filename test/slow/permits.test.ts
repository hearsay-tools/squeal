import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { acquireSlowSlot, SLOW_LOCK_FILE } from "../../src/core/slow/index.js";

/*
 * Spec 004 D2 as amended 2026-10-09: the slot is `slow.maxParallel` permits
 * per user; an idle tier of k files takes k of them, a one-file tier one.
 */

let root: string;
let dir: string;
const owner = { pid: process.pid, worktreeId: "test" };

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "squeal-permits-test-"));
  dir = join(root, "squeal-uid");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("the slot's permits (spec 004 D2, slow.maxParallel)", () => {
  test("takes as many free permits as wanted, up to the user's permits", () => {
    const a = acquireSlowSlot({ dir, owner, permits: 3, want: 2 });
    expect(a?.permits).toBe(2);
    const b = acquireSlowSlot({ dir, owner, permits: 3, want: 2 });
    expect(b?.permits).toBe(1);
    expect(acquireSlowSlot({ dir, owner, permits: 3, want: 1 })).toBeNull();
    a?.release();
    a?.release();
    const c = acquireSlowSlot({ dir, owner, permits: 3, want: 4 });
    expect(c?.permits).toBe(2);
    b?.release();
    c?.release();
  });

  test("one permit is slow.lock, the slot of a daemon that knows no permits", () => {
    const one = acquireSlowSlot({ dir, owner });
    expect(one?.permits).toBe(1);
    // A tier of several files still runs beside it, on the other permits.
    const wide = acquireSlowSlot({ dir, owner, permits: 4, want: 4 });
    expect(wide?.permits).toBe(3);
    expect(acquireSlowSlot({ dir, owner, permits: 1, want: 1 })).toBeNull();
    one?.release();
    const again = acquireSlowSlot({ dir, owner, permits: 1, want: 1 });
    expect(again?.permits).toBe(1);
    again?.release();
    wide?.release();
    expect(SLOW_LOCK_FILE).toBe("slow.lock");
  });

  test("shrinkTo keeps the first permits and frees the others", () => {
    const slot = acquireSlowSlot({ dir, owner, permits: 4, want: 4 });
    expect(slot?.permits).toBe(4);
    slot?.shrinkTo(1);
    expect(slot?.permits).toBe(1);
    const other = acquireSlowSlot({ dir, owner, permits: 4, want: 4 });
    expect(other?.permits).toBe(3);
    slot?.shrinkTo(0);
    expect(slot?.permits).toBe(1);
    other?.release();
    slot?.release();
    expect(slot?.permits).toBe(0);
  });

  test("an aborted signal releases every permit", () => {
    const controller = new AbortController();
    const slot = acquireSlowSlot({ dir, owner, permits: 2, want: 2, signal: controller.signal });
    expect(acquireSlowSlot({ dir, owner, permits: 2 })).toBeNull();
    controller.abort();
    const next = acquireSlowSlot({ dir, owner, permits: 2, want: 2 });
    expect(next?.permits).toBe(2);
    next?.release();
    slot?.release();
  });
});
