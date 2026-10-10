import { describe, expect, it, onTestFinished, vi } from "vitest";
import { Discharges, HOLD_MS } from "../../src/core/scheduler/discharges.js";
import { type FileState, newFileState } from "../../src/core/scheduler/files.js";
import { ref } from "./helpers.js";

/*
 * Review wave 13l, S1 (task 001-202): discharges are kept per file and
 * revision, so a later one never replaces the earlier one a captured wait
 * asks for, and they stay bounded by age and count over a long session.
 */

const math = ref("test/math.test.ts");

function moved(path: string, revision: number): FileState {
  return { ...newFileState(ref(path)), keyedAt: revision, lastKeyedAt: revision };
}

/** Fake timers, and the clock `Discharges` reads; `advance` moves both, setting `clock.at` alone is a pause. */
function fakeClock(): { at: number; now: () => number; advance: (ms: number) => void } {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  onTestFinished(() => {
    vi.useRealTimers();
  });
  const clock = {
    at: 0,
    now: () => clock.at,
    advance: (ms: number) => {
      clock.at += ms;
      vi.advanceTimersByTime(ms);
    },
  };
  return clock;
}

describe("discharges (task 001-202)", () => {
  it("keeps an earlier move's discharge through a later one", () => {
    const discharges = new Discharges();
    discharges.note(moved(math.path, 3), 1_000);
    discharges.note(moved(math.path, 5), 2_000);

    expect(discharges.since(500, 0, 4)).toEqual([{ testFile: math, revision: 3, resolved: true }]);
    expect(discharges.since(500, 0, 5)).toEqual([
      { testFile: math, revision: 3, resolved: true },
      { testFile: math, revision: 5, resolved: true },
    ]);
    // Discharged before the wait started: not its news.
    expect(discharges.since(1_500, 0, 4)).toEqual([]);
  });

  it("drops what no wait can still ask for, and forgets a removed file", () => {
    const discharges = new Discharges({ retentionMs: 1_000, cap: 100 });
    discharges.note(moved(math.path, 1), 0);
    discharges.note(moved("test/strings.test.ts", 2), 500);
    discharges.note(moved(math.path, 3), 1_200);
    expect(discharges.since(0, 0, 3).map((file) => file.revision)).toEqual([2, 3]);

    discharges.forget(newFileState(math).id);
    expect(discharges.since(0, 0, 3).map((file) => file.revision)).toEqual([2]);
  });

  it("stays bounded over a long session", () => {
    const discharges = new Discharges({ retentionMs: Number.POSITIVE_INFINITY, cap: 50 });
    for (let revision = 1; revision <= 1_000; revision += 1) {
      discharges.note(moved(`test/f${revision % 300}.test.ts`, revision), revision);
    }
    expect(discharges.size).toBe(50);
    // The newest are kept.
    expect(discharges.since(0, 950, 1_000)).toHaveLength(50);
  });

  it.each([
    { name: "count", limits: { retentionMs: Number.POSITIVE_INFINITY, cap: 3 }, at: 1 },
    { name: "age", limits: { retentionMs: 1_000, cap: 100 }, at: 1_001 },
  ])("keeps what a live answer needs past the $name bound (task 001-214)", ({ limits, at }) => {
    const discharges = new Discharges(limits);
    discharges.note(moved(math.path, 3), 0);
    const held = discharges.hold(0, 2, 4, 0);
    for (let n = 0; n < 4; n += 1) discharges.note(moved(`test/f${n}.test.ts`, 5), at);

    expect(discharges.since(0, 2, 4)).toEqual([{ testFile: math, revision: 3, resolved: true }]);
    expect(held.intact(at)).toBe(true);
    held.release();
    discharges.note(moved("test/next.test.ts", 5), at);
    expect(discharges.since(0, 2, 4)).toEqual([]);
  });

  it("returns to its cap once the answer that held more is released (task 001-214)", () => {
    const discharges = new Discharges({ retentionMs: Number.POSITIVE_INFINITY, cap: 1 });
    const held = discharges.hold(0, 2, 4, 0);
    discharges.note(moved(math.path, 3), 0);
    discharges.note(moved("test/strings.test.ts", 4), 1);
    discharges.note(moved("test/late.test.ts", 5), 2);
    expect(discharges.since(0, 0, 5).map((file) => file.revision)).toEqual([3, 4]);

    held.release();
    expect(discharges.since(0, 0, 5).map((file) => file.revision)).toEqual([4]);
  });

  it.each([
    { name: "count", limits: { retentionMs: Number.POSITIVE_INFINITY, cap: 3 }, at: 1 },
    { name: "age", limits: { retentionMs: 1_000, cap: 100 }, at: 1_501 },
  ])("prunes past the $name bound what no live answer needs (task 001-214)", ({ limits, at }) => {
    const discharges = new Discharges(limits);
    // Before the answer's start, at or below its `after`, and above its captured revision.
    discharges.note(moved("test/early.test.ts", 3), 0);
    discharges.note(moved("test/old.test.ts", 2), 500);
    discharges.note(moved("test/late.test.ts", 5), 500);
    discharges.hold(500, 2, 4, 500);
    for (let n = 0; n < 3; n += 1) discharges.note(moved(`test/f${n}.test.ts`, 6), at);

    expect(discharges.since(0, 0, 5)).toEqual([]);
    expect(discharges.size).toBe(3);
  });

  it("releases a forgotten hold at once, idempotently, and its answer is not intact (task 001-226)", () => {
    const discharges = new Discharges({ retentionMs: Number.POSITIVE_INFINITY, cap: 2 });
    discharges.note(moved(math.path, 3), 0);
    const forgotten = discharges.hold(0, 2, 4, 1);
    const kept = discharges.hold(0, 2, 4, 1);
    discharges.note(moved("test/strings.test.ts", 5), 2);
    expect(discharges.holds).toBe(2);

    forgotten.forget();
    expect(discharges.holds).toBe(1);
    expect(forgotten.intact(3)).toBe(false);
    expect(kept.intact(3)).toBe(true);
    // Again, or released after, is nothing.
    forgotten.forget();
    forgotten.release();
    expect(discharges.holds).toBe(1);
    kept.release();
    expect(discharges.holds).toBe(0);
    discharges.note(moved("test/late.test.ts", 6), 4);
    expect(discharges.since(0, 0, 6).map((file) => file.revision)).toEqual([5, 6]);
  });

  it("releases every hold at its deadline, read or not, and prunes what it kept (review wave-13r B2)", () => {
    const discharges = new Discharges({ retentionMs: 1_000, cap: 100 });
    discharges.note(moved(math.path, 3), 0);
    const held = discharges.hold(0, 2, 4, 10);
    discharges.note(moved("test/strings.test.ts", 5), 5_000);
    expect(discharges.since(0, 2, 4)).toHaveLength(1);
    expect(held.intact(5_000)).toBe(true);

    discharges.note(moved("test/late.test.ts", 6), 10 + HOLD_MS);
    expect(discharges.holds).toBe(0);
    expect(discharges.since(0, 0, 6).map((file) => file.revision)).toEqual([6]);
    expect(held.intact(10 + HOLD_MS)).toBe(false);
  });

  it("is not intact when a discharge its window covers was dropped before it was taken", () => {
    const discharges = new Discharges({ retentionMs: Number.POSITIVE_INFINITY, cap: 1 });
    discharges.note(moved(math.path, 3), 100);
    discharges.note(moved("test/strings.test.ts", 4), 200);
    // An evicted wait asks again with its own start: math's discharge is gone.
    expect(discharges.hold(50, 0, 4, 300).intact(300)).toBe(false);
    // A wait that started after it lost nothing.
    expect(discharges.hold(150, 0, 4, 300).intact(300)).toBe(true);
  });

  it("ends a hold at its deadline with no later call, prunes by that time, keeps a younger hold (task 001-229)", () => {
    const clock = fakeClock();
    const discharges = new Discharges({ retentionMs: HOLD_MS / 2, cap: 3 }, clock.now);
    const expired: string[] = [];
    discharges.note(moved(math.path, 3), 0);
    discharges.note(moved("test/strings.test.ts", 3), 0);
    discharges.note(moved("test/upper.test.ts", 3), 0);
    const old = discharges.hold(0, 2, 4, 0, () => expired.push("old"));
    clock.advance(HOLD_MS / 2);
    const young = discharges.hold(HOLD_MS / 2, 2, 4, HOLD_MS / 2, () => expired.push("young"));
    discharges.note(moved("test/young.test.ts", 4), HOLD_MS / 2);
    // Past the cap, every discharge kept: the old hold covers them all.
    expect(discharges.size).toBe(4);

    // No discharge, hold or read: the old hold's hour ends on time.
    clock.advance(HOLD_MS / 2);
    expect(expired).toEqual(["old"]);
    expect(discharges.holds).toBe(1);
    // Pruned at the deadline, not at the last discharge: the hour-old ones go too.
    expect(discharges.since(0, 0, 4).map((file) => file.testFile.path)).toEqual([
      "test/young.test.ts",
    ]);
    expect(young.intact(HOLD_MS)).toBe(true);
    expect(old.intact(HOLD_MS)).toBe(false);

    // Released, forgotten or expired again is nothing.
    old.forget();
    old.release();
    clock.advance(HOLD_MS / 2);
    expect(expired).toEqual(["old", "young"]);
    expect(discharges.holds).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("clears its timer once no hold is left (task 001-229)", () => {
    const clock = fakeClock();
    const discharges = new Discharges(undefined, clock.now);
    let expired = 0;
    const first = discharges.hold(0, 0, 1, 0, () => {
      expired += 1;
    });
    const second = discharges.hold(0, 0, 1, 10, () => {
      expired += 1;
    });
    expect(vi.getTimerCount()).toBe(1);
    first.release();
    second.forget();
    expect(vi.getTimerCount()).toBe(0);
    clock.advance(2 * HOLD_MS);
    expect(expired).toBe(0);
  });

  it("releases every hold overdue when a paused callback runs, prunes and re-arms from then (task 001-232)", () => {
    const clock = fakeClock();
    const minute = HOLD_MS / 60;
    const discharges = new Discharges({ retentionMs: HOLD_MS, cap: 100 }, clock.now);
    const expired: string[] = [];
    discharges.hold(0, 2, 4, clock.now(), () => expired.push("old"));
    clock.advance(31 * minute);
    discharges.hold(clock.now(), 4, 6, clock.now(), () => expired.push("young"));
    clock.advance(19 * minute);
    // Kept by the old hold, and by age until minute 110.
    discharges.note(moved(math.path, 3), clock.now());

    // The process pauses from minute 50 to 132: the callback due at 60 runs then.
    clock.at = 132 * minute;
    vi.advanceTimersByTime(10 * minute);
    expect(expired).toEqual(["old", "young"]);
    expect(discharges.holds).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    // Pruned at the callback's own time, not at the old deadline.
    expect(discharges.since(0, 0, 6)).toEqual([]);
  });

  it("re-arms a younger hold from the time a late callback runs (task 001-232)", () => {
    const clock = fakeClock();
    const minute = HOLD_MS / 60;
    const discharges = new Discharges(undefined, clock.now);
    const expired: string[] = [];
    discharges.hold(0, 0, 1, clock.now(), () => expired.push("old"));
    clock.advance(31 * minute);
    discharges.hold(0, 0, 1, clock.now(), () => expired.push("young"));

    // Paused past the old deadline only: the young one is due at minute 91.
    clock.at = 70 * minute;
    vi.advanceTimersByTime(29 * minute);
    expect(expired).toEqual(["old"]);
    clock.advance(21 * minute - 1);
    expect(expired).toEqual(["old"]);
    clock.advance(1);
    expect(expired).toEqual(["old", "young"]);
    expect(vi.getTimerCount()).toBe(0);
  });
});
