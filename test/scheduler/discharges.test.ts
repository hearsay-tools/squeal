import { describe, expect, it } from "vitest";
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
});
