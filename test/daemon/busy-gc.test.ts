import { describe, expect, it, vi } from "vitest";
import {
  BUSY_GC_EVERY_MS,
  BUSY_GC_RATIO,
  busyGcDue,
  IDLE_GC_AFTER_MS,
} from "../../src/core/daemon/idle-gc.js";
import { LAST_RESORT, MIB, subject, tier } from "./idle-gc-subject.js";

/*
 * Spec 021 D21.2 (row 021-29, research `021/daemon-heap.md` 1 and
 * recommendation 3): a busy daemon never has the idle GC's 60 s without a
 * tier, so it also runs one last-resort GC after a tier when its heap in use
 * is above twice the last live size, at most once a minute. Driven with a
 * test clock, a test heap reading and a recording `gc` that lowers the heap
 * to `heap.live`.
 */

describe("busyGcDue", () => {
  const busy = {
    now: 1_000_000,
    tierEnded: true,
    lastGc: 1_000_000 - BUSY_GC_EVERY_MS,
    live: 100 * MIB,
  };

  it("is due after a tier when heap in use is above twice the live size, not at it", () => {
    expect(BUSY_GC_RATIO).toBe(2);
    expect(busyGcDue({ ...busy, heapInUse: 200 * MIB + 1 })).toBe(true);
    expect(busyGcDue({ ...busy, heapInUse: 200 * MIB })).toBe(false);
  });

  it("is due a minute after the last GC, not before, and with no GC yet", () => {
    expect(BUSY_GC_EVERY_MS).toBe(60_000);
    const over = { ...busy, heapInUse: 300 * MIB };
    expect(busyGcDue({ ...over, lastGc: busy.now - BUSY_GC_EVERY_MS + 1 })).toBe(false);
    expect(busyGcDue({ ...over, lastGc: null })).toBe(true);
  });

  it("is never due without a tier's end since the last check, or before a live size was read", () => {
    const over = { ...busy, heapInUse: 300 * MIB };
    expect(busyGcDue({ ...over, tierEnded: false })).toBe(false);
    expect(busyGcDue({ ...over, live: null })).toBe(false);
  });
});

describe("the busy GC (row 021-29)", () => {
  const BUSY_LINE =
    /^busy, heap in use (\d+) MiB over twice the last live size of (\d+) MiB: a last-resort GC took private memory from 900 to 500 MiB in a \d+ ms pause; (\d+) MiB of heap in use after it$/;

  it("after a tier, collects above twice the live size the last GC left, and logs before and after", () => {
    const t = subject();
    t.idle.ready();
    t.heap.live = 150 * MIB;
    t.advance(IDLE_GC_AFTER_MS);
    t.idle.check();
    expect(t.gc).toHaveBeenCalledTimes(1);
    t.advance(BUSY_GC_EVERY_MS);
    t.heap.now = 300 * MIB;
    tier(t);
    t.idle.check();
    expect(t.gc).toHaveBeenCalledTimes(1);
    t.heap.now = 301 * MIB;
    t.heap.live = 120 * MIB;
    tier(t);
    t.idle.check();
    expect(t.gc).toHaveBeenCalledTimes(2);
    expect(t.gc).toHaveBeenLastCalledWith(LAST_RESORT);
    expect(t.lines).toHaveLength(2);
    expect(t.lines[1]?.match(BUSY_LINE)?.slice(1)).toEqual(["301", "150", "120"]);
    // The live size is now what this GC left: 240 MiB is not above twice 120, 241 is.
    t.advance(BUSY_GC_EVERY_MS);
    t.heap.now = 240 * MIB;
    tier(t);
    t.idle.check();
    expect(t.gc).toHaveBeenCalledTimes(2);
    t.heap.now = 241 * MIB;
    tier(t);
    t.idle.check();
    expect(t.gc).toHaveBeenCalledTimes(3);
    expect(t.notes).toEqual([]);
  });

  it("runs at most one a minute while tiers keep ending above the ratio", () => {
    const t = subject();
    t.idle.ready();
    const start = t.now();
    // A queue draining: a 10 s tier after another for 3 minutes, each regrowing the heap.
    for (let i = 0; i < 18; i++) {
      t.heap.now = 300 * MIB;
      tier(t, 10_000);
      t.idle.check();
    }
    expect(t.gcAt.map((at) => at - start)).toEqual([10_000, 70_000, 130_000]);
    expect(t.lines).toHaveLength(3);
    expect(t.lines.every((line) => BUSY_LINE.test(line))).toBe(true);
  });

  it("before the first GC, takes the lowest heap in use read at ready and after tiers as the live size", () => {
    const t = subject();
    t.heap.now = 300 * MIB;
    t.idle.ready();
    t.heap.now = 120 * MIB;
    tier(t);
    t.idle.check();
    t.heap.now = 240 * MIB;
    tier(t);
    t.idle.check();
    expect(t.gc).not.toHaveBeenCalled();
    t.heap.now = 241 * MIB;
    t.heap.live = 150 * MIB;
    tier(t);
    t.idle.check();
    expect(t.gc).toHaveBeenCalledTimes(1);
    expect(t.lines[0]?.match(BUSY_LINE)?.slice(1)).toEqual(["241", "120", "150"]);
    // From the first GC on, what it left: 290 MiB stays under twice 150.
    t.advance(BUSY_GC_EVERY_MS);
    t.heap.now = 290 * MIB;
    tier(t);
    t.idle.check();
    expect(t.gc).toHaveBeenCalledTimes(1);
  });

  it("looks at the heap only at a check after a tier ended, not during a long tier", () => {
    const t = subject();
    t.idle.ready();
    t.heap.now = 150 * MIB;
    tier(t);
    t.idle.check();
    // A long tier: the heap grows, but none ended since the last check.
    t.idle.started();
    t.heap.now = 400 * MIB;
    t.advance(2 * BUSY_GC_EVERY_MS);
    t.idle.check();
    expect(t.gc).not.toHaveBeenCalled();
    t.idle.ended();
    t.idle.check();
    expect(t.gc).toHaveBeenCalledTimes(1);
  });

  it("leaves the idle GC as it was, and an idle GC holds the next busy one back a minute", () => {
    const t = subject();
    t.idle.ready();
    t.heap.now = 300 * MIB;
    tier(t);
    t.idle.check();
    expect(t.lines).toEqual([expect.stringMatching(BUSY_LINE)]);
    // No tier since: the idle GC still runs 60 s after the last one ended.
    t.advance(IDLE_GC_AFTER_MS - 1);
    t.idle.check();
    expect(t.gc).toHaveBeenCalledTimes(1);
    t.advance(1);
    t.idle.check();
    expect(t.gc).toHaveBeenCalledTimes(2);
    expect(t.lines[1]).toMatch(/^no tier for 60 s: a last-resort GC took /);
    const idleAt = t.now();
    t.advance(10_000);
    t.heap.now = 300 * MIB;
    tier(t);
    t.idle.check();
    expect(t.gc).toHaveBeenCalledTimes(2);
    t.advance(idleAt + BUSY_GC_EVERY_MS - t.now());
    tier(t, 0);
    t.idle.check();
    expect(t.gc).toHaveBeenCalledTimes(3);
  });

  it("without gc, persists the one note and keeps running", () => {
    const lookup = vi.fn(() => null);
    const t = subject({ lookup });
    t.idle.ready();
    for (let i = 0; i < 3; i++) {
      t.heap.now = 300 * MIB;
      tier(t, BUSY_GC_EVERY_MS);
      expect(() => t.idle.check()).not.toThrow();
    }
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(t.notes).toEqual([
      "no last-resort GC: V8's gc is not available; this daemon runs on without it",
    ]);
    expect(t.lines).toEqual([]);
  });
});
