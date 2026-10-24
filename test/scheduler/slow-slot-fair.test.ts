import { mkdtempSync, readdirSync, rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { readDaemonNotes } from "../../src/core/notes.js";
import { markSlotWaiter, SLOT_WAITER_FRESH_MS } from "../../src/core/slow/index.js";
import { readSlowActivity } from "../../src/core/slow/state.js";
import { DEFAULT_POLICY } from "../../src/core/types/index.js";
import { RUN_MISSING } from "../helpers/baseline.js";
import { claimRepo, fileName, type Side, side } from "./claims-fixture.js";

/*
 * Task 004-84, spec 004 D3 as amended: the load guard decides whether the
 * slow lane runs, never which worktree runs it. Two daemons of two
 * repositories share one slot directory of one permit, as cezar's
 * `slow.maxParallel: 1`; the load is injected. `a` is past its
 * `slow.maxDeferMs` (100 ms) and runs file after file; `b` is fresh, its
 * budget the default 10 minutes.
 */

const probes = vi.hoisted(() => ({ count: 0 }));

vi.mock("../../src/core/slow/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/core/slow/index.js")>();
  return {
    ...actual,
    slowSlotHeld: (...args: Parameters<typeof actual.slowSlotHeld>) => {
      probes.count += 1;
      return actual.slowSlotHeld(...args);
    },
  };
});

const OVER = 8;
const UNDER = 0.5;
const PAST_BUDGET_MS = 100;

function slotDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "squeal-004-84-slot-"));
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** A daemon of its own repository of `count` slow files over the shared `dir`, under `load` per CPU. */
function daemon(
  dir: string,
  { count, load, maxDeferMs }: { count: number; load: number; maxDeferMs?: number },
): Side & { reads: () => number } {
  const { main } = claimRepo(count);
  const include = Array.from({ length: count }, (_, i) => fileName(i));
  let reads = 0;
  const s = side(main, {
    count,
    policy: {
      ...RUN_MISSING,
      slow: {
        ...DEFAULT_POLICY.slow,
        include,
        maxParallel: 1,
        ...(maxDeferMs === undefined ? {} : { maxDeferMs }),
      },
    },
    slow: {
      slotDir: dir,
      recheckMs: 25,
      load: () => {
        reads += 1;
        return [load];
      },
      cpus: () => 1,
    },
  });
  return { ...s, reads: () => reads };
}

/** Logs each run of `s` as `name` in `order`. */
function logRuns(s: Side, name: string, order: string[]): void {
  s.runner.during = () => {
    order.push(name);
  };
}

const ranUnderLoad = (s: Side) =>
  readDaemonNotes(s.store, s.worktreeId).filter((n) => n.text.includes("ran under load")).length;

const marks = (dir: string) => readdirSync(dir).filter((name) => name.startsWith("slow.wait."));

describe("the load guard never picks the worktree (task 004-84)", { timeout: 30_000 }, () => {
  it("a fresh daemon waits at the slot and runs a slow file at the next handover", async () => {
    const dir = slotDir();
    const order: string[] = [];
    const a = daemon(dir, { count: 4, load: OVER, maxDeferMs: PAST_BUDGET_MS });
    logRuns(a, "a", order);
    a.runner.hold();
    await a.scheduler.start();
    await expect.poll(() => a.runner.active, { timeout: 5_000 }).toBe(1);
    expect(ranUnderLoad(a)).toBe(1);

    const b = daemon(dir, { count: 2, load: OVER });
    logRuns(b, "b", order);
    await b.scheduler.start();
    await expect
      .poll(() => readSlowActivity(b.store, b.worktreeId), { timeout: 5_000 })
      .toEqual({ kind: "waiting", for: "slot" });
    expect(marks(dir)).toHaveLength(1);

    // `a`'s file ends; were `a` to take the slot again, its next file would hold.
    a.runner.release();
    a.runner.hold();
    await expect.poll(() => b.runner.runs.length, { timeout: 5_000 }).toBeGreaterThan(0);
    expect(order.slice(0, 2)).toEqual(["a", "b"]);
    // The handover ran it without a guard wait: no budget spent, so no note.
    expect(ranUnderLoad(b)).toBe(0);
  });

  it("a guard wait gives way once another worktree takes the slot", async () => {
    const dir = slotDir();
    const order: string[] = [];
    const b = daemon(dir, { count: 2, load: OVER });
    logRuns(b, "b", order);
    await b.scheduler.start();
    await expect
      .poll(() => readSlowActivity(b.store, b.worktreeId), { timeout: 5_000 })
      .toEqual({ kind: "waiting", for: "load" });

    const a = daemon(dir, { count: 4, load: OVER, maxDeferMs: PAST_BUDGET_MS });
    logRuns(a, "a", order);
    a.runner.hold();
    await a.scheduler.start();
    await expect.poll(() => a.runner.active, { timeout: 5_000 }).toBe(1);
    await expect
      .poll(() => readSlowActivity(b.store, b.worktreeId), { timeout: 5_000 })
      .toEqual({ kind: "waiting", for: "slot" });

    a.runner.release();
    a.runner.hold();
    await expect.poll(() => b.runner.runs.length, { timeout: 5_000 }).toBeGreaterThan(0);
    expect(order.slice(0, 2)).toEqual(["a", "b"]);
  });

  it("with the slot free and the load above the threshold, a slow file still defers", async () => {
    const dir = slotDir();
    const b = daemon(dir, { count: 2, load: OVER });
    await b.scheduler.start();
    await expect.poll(() => b.reads(), { timeout: 5_000 }).toBeGreaterThanOrEqual(5);
    await delay(200);
    expect(b.runner.runs).toEqual([]);
    expect(readSlowActivity(b.store, b.worktreeId)).toEqual({ kind: "waiting", for: "load" });
    expect(marks(dir)).toEqual([]);
  });

  it("below the threshold nothing changes: the slot is handed over file by file, unprobed", async () => {
    const dir = slotDir();
    const before = probes.count;
    const order: string[] = [];
    const a = daemon(dir, { count: 3, load: UNDER, maxDeferMs: PAST_BUDGET_MS });
    logRuns(a, "a", order);
    a.runner.hold();
    await a.scheduler.start();
    await expect.poll(() => a.runner.active, { timeout: 5_000 }).toBe(1);

    const b = daemon(dir, { count: 2, load: UNDER });
    logRuns(b, "b", order);
    await b.scheduler.start();
    await expect
      .poll(() => readSlowActivity(b.store, b.worktreeId), { timeout: 5_000 })
      .toEqual({ kind: "waiting", for: "slot" });

    a.runner.release();
    await expect.poll(() => order.length, { timeout: 5_000 }).toBe(5);
    expect(order).toEqual(["a", "b", "a", "b", "a"]);
    expect(ranUnderLoad(a) + ranUnderLoad(b)).toBe(0);
    expect(probes.count).toBe(before);
  });
});

/*
 * Row 011-99: a close whose preempt found no guard wait in progress still
 * ends the next one. The start's pump is in its install check when the
 * close comes, before its slow pass; under load a pump of any daemon can be.
 * Before the fix the guard waited out `b`'s 10-minute budget and the close
 * with it, as the teardown hook that timed out at 10 s did.
 */
describe("a close ends a guard wait that had not begun (row 011-99)", { timeout: 30_000 }, () => {
  it("closes at once and reads the load no more", async () => {
    const b = daemon(slotDir(), { count: 2, load: OVER });
    await b.scheduler.start();
    const closing = b.scheduler.close().then(() => "closed");
    const waited = delay(5_000, "waiting", { ref: false });
    expect(await Promise.race([closing, waited])).toBe("closed");
    const reads = b.reads();
    await delay(200);
    expect(b.reads()).toBe(reads);
  });
});

/*
 * 011 C9 and 004 D2 as amended 2026-10-21 (row 011-84, code row 011-93): a
 * draining daemon leaves no waiter mark and takes no permit while another
 * worktree's mark is fresh, so a live session's slow files never wait
 * behind a departed one's.
 */
describe("a draining daemon yields the slot (row 011-93)", { timeout: 30_000 }, () => {
  it("takes no permit and writes no mark while another worktree's mark is fresh, then takes one", async () => {
    const dir = slotDir();
    // A live session's daemon in another worktree waits for the slot.
    markSlotWaiter(dir, "feedfacefeedface");
    const [other] = marks(dir);
    const a = daemon(dir, { count: 2, load: UNDER });
    a.scheduler.pauseBacklog(true);
    await a.scheduler.start();
    await expect
      .poll(() => readSlowActivity(a.store, a.worktreeId), { timeout: 5_000 })
      .toEqual({ kind: "waiting", for: "slot" });
    await delay(200);
    expect(a.runner.runs).toEqual([]);
    expect(marks(dir)).toEqual([other]);

    // The other daemon stopped refreshing its mark: once it is stale the drain runs.
    const stale = (Date.now() - SLOT_WAITER_FRESH_MS - 1_000) / 1000;
    utimesSync(join(dir, other ?? ""), stale, stale);
    await expect.poll(() => a.runner.runs.length, { timeout: 5_000 }).toBeGreaterThan(0);
    expect(marks(dir)).toEqual([other]);
  });

  it("a daemon that is not draining takes the free slot beside the same mark", async () => {
    const dir = slotDir();
    markSlotWaiter(dir, "feedfacefeedface");
    const a = daemon(dir, { count: 2, load: UNDER });
    await a.scheduler.start();
    await expect.poll(() => a.runner.runs.length, { timeout: 5_000 }).toBeGreaterThan(0);
  });
});
