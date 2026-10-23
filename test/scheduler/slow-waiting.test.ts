import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { describe, expect, it, onTestFinished } from "vitest";
import { markSlotWaiter } from "../../src/core/slow/index.js";
import { readSlowActivity } from "../../src/core/slow/state.js";
import { DEFAULT_POLICY } from "../../src/core/types/index.js";
import { claimRepo, fileName, type Side, side } from "./claims-fixture.js";

/*
 * 011 C9 and 004 D2 as amended 2026-10-23 (row 011-163): once a drain's fast
 * work is done, its slow files' wait for a run is told to the departure
 * check, which ends the drain after 60 s of it. `slowWaiting` is that wait:
 * since when no slow file ran and no fast drain work was pending, and the
 * slow files it would leave queued. A live session's fresh waiter mark makes
 * the draining daemon yield the slot (row 011-93), so its slow files wait.
 */

const OTHER = "feedfacefeedface";

function slotDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "squeal-011-163-slot-"));
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** A daemon of `count` files, the first `slow` of them slow, over the slot in `dir`. */
function drainSide(dir: string, count: number, slow = count): Side {
  const { main } = claimRepo(count);
  return side(main, {
    count,
    policy: {
      // The baseline queues every miss, whatever default later rows give `onStart`.
      baseline: { onStart: "lookup-then-run-missing" },
      slow: {
        ...DEFAULT_POLICY.slow,
        include: Array.from({ length: slow }, (_, i) => fileName(i)),
        maxParallel: 1,
      },
    },
    slow: { slotDir: dir, recheckMs: 25, load: () => [0.5], cpus: () => 1 },
  });
}

const waitingAtSlot = (s: Side) =>
  expect
    .poll(() => readSlowActivity(s.store, s.worktreeId), { timeout: 5_000 })
    .toEqual({ kind: "waiting", for: "slot" });

describe("a drain's slow lane tells how long it waited (row 011-163)", { timeout: 30_000 }, () => {
  it("waits from the drain's first check while its slow files wait at the slot, and names them", async () => {
    const dir = slotDir();
    markSlotWaiter(dir, OTHER);
    const a = drainSide(dir, 2);
    a.scheduler.pauseBacklog(true);
    await a.scheduler.start();
    await waitingAtSlot(a);

    const before = Date.now();
    // The drain's first check starts its wait.
    expect(a.scheduler.slowWaiting()).toBeNull();
    const after = Date.now();
    const waiting = a.scheduler.slowWaiting();
    expect(waiting?.since).toBeGreaterThanOrEqual(before);
    expect(waiting?.since).toBeLessThanOrEqual(after);
    expect([...(waiting?.paths ?? [])].sort()).toEqual([fileName(0), fileName(1)]);
    expect(a.runner.runs).toEqual([]);

    // A session registered: no drain, no wait.
    a.scheduler.pauseBacklog(false);
    expect(a.scheduler.slowWaiting()).toBeNull();
    // A later drain waits from its own first check.
    a.scheduler.pauseBacklog(true);
    const again = Date.now();
    expect(a.scheduler.slowWaiting()).toBeNull();
    expect(a.scheduler.slowWaiting()?.since ?? 0).toBeGreaterThanOrEqual(again);
  });

  it("a slow file running is no wait; the wait counts from its end", async () => {
    const dir = slotDir();
    const a = drainSide(dir, 2);
    a.runner.hold();
    a.scheduler.pauseBacklog(true);
    await a.scheduler.start();
    await expect.poll(() => a.runner.active, { timeout: 5_000 }).toBe(1);
    expect(a.scheduler.slowWaiting()).toBeNull();
    expect(a.scheduler.slowWaiting()).toBeNull();

    // A live session waits now: the drain's next file yields the slot to it.
    markSlotWaiter(dir, OTHER);
    // So the run's end is later than the last check that found it running.
    await delay(50);
    const released = Date.now();
    a.runner.release();
    await waitingAtSlot(a);
    const waiting = a.scheduler.slowWaiting();
    expect(waiting?.since).toBeGreaterThanOrEqual(released);
    expect(waiting?.paths).toHaveLength(1);
    expect(a.runner.runs).toHaveLength(1);
  });

  it("an edit's fast work is no wait; the wait counts from its end", async () => {
    const dir = slotDir();
    markSlotWaiter(dir, OTHER);
    const a = drainSide(dir, 3, 2);
    a.scheduler.pauseBacklog(true);
    await a.scheduler.start();
    await waitingAtSlot(a);
    expect(a.scheduler.slowWaiting()).toBeNull();
    await expect.poll(() => a.scheduler.slowWaiting(), { timeout: 5_000 }).not.toBeNull();
    // The paused baseline left the fast file queued, not run.
    expect(a.runner.runs).toEqual([]);

    a.runner.hold();
    // So the edit is later than the check that started the wait.
    await delay(50);
    const edited = Date.now();
    writeFileSync(join(a.root, fileName(2)), "// edited\n");
    await a.batch(fileName(2));
    await expect.poll(() => a.runner.active, { timeout: 5_000 }).toBe(1);
    expect(a.scheduler.slowWaiting()).toBeNull();

    a.runner.release();
    await expect.poll(() => a.runner.active, { timeout: 5_000 }).toBe(0);
    await expect.poll(() => a.scheduler.slowWaiting(), { timeout: 5_000 }).not.toBeNull();
    const waiting = a.scheduler.slowWaiting();
    expect(waiting?.since).toBeGreaterThanOrEqual(edited);
    expect([...(waiting?.paths ?? [])].sort()).toEqual([fileName(0), fileName(1)]);
    expect(a.runner.runs).toEqual([[{ project: "", path: fileName(2) }]]);
  });
});
