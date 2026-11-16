import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import {
  CLAIM_POLL_MS,
  CLAIM_RECHECK_MS,
  claimPoll,
  claimWindow,
} from "../../src/core/scheduler/claims.js";
import { clockOf, hostClock, MAX_TIMER_MS } from "../../src/core/scheduler/clock.js";
import { readGroupActivity } from "../../src/core/slow/state.js";
import type { CheckGroup } from "../../src/core/types/check-groups.js";
import type { Store } from "../../src/core/types/store.js";
import { type VirtualClock, virtualClock } from "../helpers/virtual-clock.js";
import { catchUpRepo, catchUpSide } from "./catch-up-fixture.js";
import { allCurrent, FILES, groupPolicy, runnerLane, tierLog } from "./group-lanes-fixture.js";
import { settle } from "./tier-yields-fixture.js";

/*
 * Row 011-351 (card 7, `research/scheduler-step.md`, "The clock port"): the
 * scheduler's one clock. Row 011-369: it reads calendar time and elapsed
 * time. The slow lane's load budget is a wait inside one daemon, spent on
 * elapsed time: its rows run a real scheduler on a virtual clock and pin
 * that a calendar change, either way, spends none of it and gives none
 * back. The claims window compares other worktrees' stamped claims, so it
 * stays on calendar time: a table over its poll (row 011-352).
 */

describe("the clock port's adapters (row 011-351)", () => {
  it("clamps the host timer's delay to a 32-bit range; reads elapsed time on `performance`", () => {
    // Review 0.1.512 S1: made before the fake timers, so only a lookup per reading and per arm sees them.
    const clock = hostClock();
    const shorthand = hostClock(() => 5);
    vi.useFakeTimers();
    try {
      vi.setSystemTime(1_234_000);
      expect(clock.now()).toBe(1_234_000);
      expect(shorthand.now()).toBe(5);
      // Row 011-369: elapsed time is the host's monotonic reading, apart from the calendar.
      const before = performance.now();
      expect(clock.elapsed()).toBeGreaterThanOrEqual(before);
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

  it("takes `clock`, else the host adapter", () => {
    const virtual = virtualClock(100);
    expect(clockOf({ clock: virtual })).toBe(virtual);
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

describe("the claims window on the scheduler's clock (rows 011-351, 011-352)", () => {
  // A store with no connection never moves (`changeMarker` null): only the window ends a wait.
  const still = {} as Store;

  it.each([
    { moves: [] as number[], ends: false, row: "a frozen clock never ends it" },
    { moves: [CLAIM_RECHECK_MS - 1], ends: false, row: "1 ms short of the window" },
    { moves: [CLAIM_RECHECK_MS], ends: true, row: "the window passed" },
    { moves: [-60_000, CLAIM_RECHECK_MS], ends: false, row: "a clock that went back first" },
  ])("$row", ({ moves, ends }) => {
    const start = 1_000_000;
    const window = claimWindow(still, start);
    const at = moves.reduce((now, ms) => now + ms, start);
    const poll = claimPoll(still, window, at);
    // Row 011-352: the claims owner polls at its wake; a wait that goes on polls again 250 ms on.
    expect(poll).toEqual(ends ? "ends" : at + CLAIM_POLL_MS);
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

/** The lane's recheck: the load budget is spent in steps of it. */
const RECHECK_MS = 25;

/** A worktree on `clock` whose edit's group waits for the load: it reads 10 per CPU from the edit on. */
async function loadSide(clock: VirtualClock) {
  const repo = catchUpRepo(FILES);
  const slotDir = mkdtempSync(join(tmpdir(), "squeal-011-351-slot-"));
  onTestFinished(() => rmSync(slotDir, { recursive: true, force: true }));
  let load = 0;
  const side = catchUpSide(repo, repo.main, {
    files: FILES,
    hostSlots: 8,
    lane: runnerLane,
    policy: groupPolicy({ checks: [STRICT] }),
    clock,
    scheduler: { slow: { slotDir, recheckMs: RECHECK_MS, cpus: () => 1, load: () => [load] } },
  });
  await side.scheduler.start();
  await allCurrent(side);
  load = 10;
  const from = side.runner.runs.length;
  await side.edit("watch", "src/core.ts");
  await settle(side);
  expect(readGroupActivity(side.store, side.worktreeId, "strict")).toEqual({
    kind: "waiting",
    for: "load",
  });
  const ran = () => tierLog(side.runner.runs, from)["group:strict:vitest"] !== undefined;
  return { side, ran };
}

/** A move of the clock: elapsed time with its calendar, or the calendar alone. */
type Move = { readonly advance: number } | { readonly calendar: number };

describe("the slow lane's load budget on elapsed time (rows 011-351, 011-369)", () => {
  it.each([
    { moves: [] as Move[], runs: false, row: "a frozen clock spends none of it" },
    { moves: [{ advance: 4_999 }], runs: false, row: "1 ms of it left" },
    { moves: [{ advance: 2_500 }, { advance: 2_500 }], runs: true, row: "spent over two waits" },
    {
      moves: [{ advance: 3_000 }, { calendar: -2_000 }, { advance: 2_000 }],
      runs: true,
      row: "a calendar set back gives none back",
    },
    // Row 011-377: the `edit` trigger's quiet counts from when this daemon first saw the revision,
    // on elapsed time; until 0.1.523 a set-back past the edit held the group about 1 h.
    {
      moves: [{ advance: 3_000 }, { calendar: -3_600_000 }, { advance: 2_000 }],
      runs: true,
      row: "a calendar set back 1 h, past the edit, does not hold the group",
    },
    {
      moves: [{ advance: 3_000 }, { calendar: 3_600_000 }, { advance: 1_999 }],
      runs: false,
      row: "a calendar set forward 1 h spends none of it",
    },
  ])("$row", { timeout: 60_000 }, async ({ moves, runs }) => {
    const clock = virtualClock(Date.now(), { prompt: true });
    const { side, ran } = await loadSide(clock);
    for (const move of moves) {
      if ("calendar" in move) clock.shiftCalendar(move.calendar);
      else clock.advance(move.advance);
      await settle(side);
    }
    expect(ran()).toBe(runs);
  });
});
