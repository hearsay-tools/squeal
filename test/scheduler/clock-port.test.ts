import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { CLAIM_RECHECK_MS, claimWake } from "../../src/core/scheduler/claims.js";
import { clockOf, elapsed, hostClock, MAX_TIMER_MS } from "../../src/core/scheduler/clock.js";
import { readGroupActivity } from "../../src/core/slow/state.js";
import type { CheckGroup } from "../../src/core/types/check-groups.js";
import type { Store } from "../../src/core/types/store.js";
import { virtualClock } from "../helpers/virtual-clock.js";
import { catchUpRepo, catchUpSide } from "./catch-up-fixture.js";
import { allCurrent, FILES, groupPolicy, runnerLane, tierLog } from "./group-lanes-fixture.js";

/*
 * Row 011-351 (card 7, `research/scheduler-step.md`, "The clock port"): the
 * scheduler's one clock. The two differences once measured on the steady
 * clock, the slow lane's load budget and the claims window, are read on the
 * scheduler's clock now: rows of clock moves pin what each does, a frozen
 * clock spends nothing and a clock that goes back gives nothing back.
 * Timers stay real until row 011-352, so each row waits for real rechecks.
 */

describe("the clock port's adapters (row 011-351)", () => {
  it("clamps a difference at 0 and the host timer's delay to a 32-bit range", () => {
    expect([elapsed(10, 25), elapsed(25, 10), elapsed(7, 7)]).toEqual([15, 0, 0]);
    vi.useFakeTimers();
    try {
      // Looked up per arm: the fake timers installed after the clock was made are the ones used.
      const clock = hostClock(() => 5);
      expect(clock.now()).toBe(5);
      const fired: string[] = [];
      const disarm = clock.arm(MAX_TIMER_MS * 4, () => fired.push("far"));
      clock.arm(-10, () => fired.push("past"));
      vi.advanceTimersByTime(0);
      expect(fired).toEqual(["past"]);
      vi.advanceTimersByTime(MAX_TIMER_MS - 1);
      expect(fired).toEqual(["past"]);
      vi.advanceTimersByTime(1);
      expect(fired).toEqual(["past", "far"]);
      disarm();
    } finally {
      vi.useRealTimers();
    }
  });

  it("takes `clock` over `now`, and `now` as the host adapter's reading", () => {
    const virtual = virtualClock(100);
    expect(clockOf({ clock: virtual, now: () => 1 })).toBe(virtual);
    expect(clockOf({ now: () => 7 }).now()).toBe(7);
    const host = clockOf({}).now();
    expect(Math.abs(host - Date.now())).toBeLessThan(1_000);
  });

  it("fires the virtual timers due on the way, in time order, then those armed first", () => {
    const clock = virtualClock(1_000);
    const fired: [string, number][] = [];
    const at = (name: string) => () => fired.push([name, clock.now()]);
    clock.arm(30, at("c"));
    clock.arm(10, at("a"));
    clock.arm(10, at("b"));
    const disarm = clock.arm(20, at("gone"));
    disarm();
    clock.arm(50, at("later"));
    clock.advance(30);
    expect(fired).toEqual([
      ["a", 1_010],
      ["b", 1_010],
      ["c", 1_030],
    ]);
    expect([clock.now(), clock.armed]).toEqual([1_030, 1]);
  });
});

describe("the claims window on the scheduler's clock (row 011-351)", () => {
  // A store with no connection never moves (`changeMarker` null): only the window ends a wake.
  const still = {} as Store;

  /** Whether `claimWake` settled within `ms` of real time. */
  const settledWithin = async (wake: Promise<void>, ms: number) =>
    Promise.race([wake.then(() => true), delay(ms).then(() => false)]);

  it.each([
    { moves: [] as number[], ends: false, row: "a frozen clock never ends it" },
    { moves: [CLAIM_RECHECK_MS - 1], ends: false, row: "1 ms short of the window" },
    { moves: [CLAIM_RECHECK_MS], ends: true, row: "the window passed" },
    { moves: [-60_000, CLAIM_RECHECK_MS], ends: false, row: "a clock that went back first" },
  ])("$row", async ({ moves, ends }) => {
    const virtual = virtualClock(Date.now());
    let offset = 0;
    const stop = new AbortController();
    onTestFinished(() => stop.abort());
    const wake = claimWake(still, stop.signal, () => virtual.now() + offset);
    for (const ms of moves) {
      if (ms < 0) offset += ms;
      else virtual.advance(ms);
    }
    // Two polls of 250 ms: a window that passed is seen at the first.
    expect(await settledWithin(wake, 700)).toBe(ends);
  });
});

/** A group at `edit` of the e2e file, held under a load of 10 per CPU for up to 5 s of its clock. */
const STRICT: CheckGroup = {
  name: "strict",
  runner: "vitest",
  tests: ["test/e2e/c.test.ts"],
  at: "edit",
  limits: { deferUnderLoad: { maxLoadPerCpu: 1, maxDeferMs: 5_000 } },
};

/** A worktree whose scheduler reads `now`, its load guard reading 0 until `setLoad`. */
async function loadSide(now: () => number) {
  const repo = catchUpRepo(FILES);
  const slotDir = mkdtempSync(join(tmpdir(), "squeal-011-351-slot-"));
  onTestFinished(() => rmSync(slotDir, { recursive: true, force: true }));
  let load = 0;
  let reads = 0;
  const side = catchUpSide(repo, repo.main, {
    files: FILES,
    hostSlots: 8,
    lane: runnerLane,
    policy: groupPolicy({ checks: [STRICT] }),
    now,
    scheduler: {
      slow: {
        slotDir,
        recheckMs: 25,
        cpus: () => 1,
        load: () => {
          reads += 1;
          return [load];
        },
      },
    },
  });
  await side.scheduler.start();
  await allCurrent(side);
  load = 10;
  const from = side.runner.runs.length;
  await side.edit("watch", "src/core.ts");
  await expect
    .poll(() => readGroupActivity(side.store, side.worktreeId, "strict"), { timeout: 20_000 })
    .toEqual({ kind: "waiting", for: "load" });
  /** Waits for two more rechecks of the load: each ends the wait and starts the next. */
  const rechecks = async () => {
    const before = reads;
    await expect.poll(() => reads - before, { timeout: 10_000 }).toBeGreaterThanOrEqual(2);
  };
  const ran = () => tierLog(side.runner.runs, from)["group:strict:vitest"] !== undefined;
  return { side, rechecks, ran };
}

describe("the slow lane's load budget on the scheduler's clock (row 011-351)", () => {
  it.each([
    { moves: [] as number[], runs: false, row: "a frozen clock spends none of it" },
    { moves: [4_999], runs: false, row: "1 ms of it left" },
    { moves: [2_500, 2_500], runs: true, row: "spent over two waits" },
    // Never back past the edit, whose own waits would hold the lane: 3 s + 0 + 2 s, not 3 s.
    { moves: [3_000, -2_000, 2_000], runs: true, row: "a clock that went back gives none back" },
  ])("$row", { timeout: 60_000 }, async ({ moves, runs }) => {
    const virtual = virtualClock(Date.now());
    let offset = 0;
    const { rechecks, ran } = await loadSide(() => virtual.now() + offset);
    for (const ms of moves) {
      if (ms < 0) offset += ms;
      else virtual.advance(ms);
      await rechecks();
    }
    await rechecks();
    if (runs) await expect.poll(ran, { timeout: 10_000 }).toBe(true);
    else expect(ran()).toBe(false);
  });
});
