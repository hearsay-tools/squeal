import { setTimeout as turn } from "node:timers/promises";
import { describe, expect, it } from "vitest";
import type { EpochMs } from "../../src/core/types/common.js";
import type { RunnerAdapter } from "../../src/core/types/runner.js";
import type { Rest, RestWake } from "../../src/core/types/scheduler.js";
import { catchUpRepo, catchUpSide } from "../scheduler/catch-up-fixture.js";
import { RUN_MISSING } from "./baseline.js";
import { countCalls, quiet, RunnerCalls } from "./quiet-point.js";
import { virtualClock } from "./virtual-clock.js";

/*
 * Row 011-378: the quiet point. `quiet` returns once the scheduler rests
 * and no runner call is open; it moves no virtual time but a record's
 * gather that no other wake comes at or before.
 */

const wake = (reason: string, at: number): RestWake => ({ reason, at: at as EpochMs });

const restOf = (wakes: RestWake[] = []): Rest => ({
  next: wakes[0] ?? null,
  wakes,
  busyResume: false,
});

/** A promise and its resolve. */
function deferred<T = void>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** Whether `promise` settled within a few real turns. */
async function settledSoon(promise: Promise<unknown>): Promise<boolean> {
  let done = false;
  const end = () => {
    done = true;
  };
  void promise.then(end, end);
  for (let i = 0; i < 5 && !done; i++) await turn(5);
  return done;
}

/** A runner whose runs end when the test says, counted through `calls`. */
function heldRunner(calls: RunnerCalls) {
  const ends: (() => void)[] = [];
  const runner = {
    name: "held",
    run: () => {
      const end = deferred();
      ends.push(() => end.resolve());
      return end.promise;
    },
    testFiles: async () => [],
  } as unknown as RunnerAdapter;
  return { counted: countCalls(runner, calls), runner, ends };
}

/** A side over `calls` whose rest gives `wakes`, counting its rests. */
function sideOf(calls: RunnerCalls, wakes: () => RestWake[] = () => []) {
  const side = {
    rests: 0,
    rest: async () => {
      side.rests += 1;
      return restOf(wakes());
    },
    calls,
    clock: null,
  };
  return side;
}

describe("the quiet point (row 011-378)", () => {
  it("returns at once when no runner call is open, after one rest", async () => {
    const side = sideOf(new RunnerCalls());
    expect(await settledSoon(quiet(side))).toBe(true);
    expect(side.rests).toBe(1);
  });

  it("returns only after a run in flight ends, and rests again after it", async () => {
    const calls = new RunnerCalls();
    const { counted, ends } = heldRunner(calls);
    const side = sideOf(calls);
    void counted.run([], {} as never);
    expect(calls.describe()).toBe("run ×1");

    const point = quiet(side);
    expect(await settledSoon(point)).toBe(false);
    ends[0]?.();
    await point;
    expect(calls.open).toBe(0);
    expect(side.rests).toBe(2);
  });

  it("counts a call the test replaced after the build; a call the runner lacks stays absent", async () => {
    const calls = new RunnerCalls();
    const { counted, runner } = heldRunner(calls);
    const replaced = deferred<never[]>();
    Object.assign(runner, { testFiles: () => replaced.promise });
    void counted.testFiles();
    expect(calls.describe()).toBe("testFiles ×1");
    replaced.resolve([]);
    await calls.nextEnd();
    expect(calls.open).toBe(0);
    expect(counted.recheck).toBeUndefined();
    expect(counted.name).toBe("held");
  });

  it("waits for a runner-part call while its bound is armed, not after it was abandoned", async () => {
    const calls = new RunnerCalls();
    const { counted, runner } = heldRunner(calls);
    const answer = deferred<never[]>();
    Object.assign(runner, { testFiles: () => answer.promise });
    void counted.testFiles();
    let bounded = true;
    const side = sideOf(calls, () =>
      bounded ? [wake("runner-part-bound", Date.now() + 60_000)] : [],
    );
    expect(await settledSoon(quiet(side))).toBe(false);
    answer.resolve([]);
    expect(await settledSoon(quiet(side))).toBe(true);

    // A call that never answers, once its bound came: the scheduler went on without it.
    Object.assign(runner, { testFiles: () => new Promise(() => {}) });
    void counted.testFiles();
    bounded = false;
    expect(calls.open).toBe(1);
    expect(await settledSoon(quiet(side))).toBe(true);
  });

  it("never moves a virtual clock to a wake but a record's gather", async () => {
    const clock = virtualClock(1_000_000, { prompt: true });
    const start = clock.now();
    const calls = new RunnerCalls();
    const { counted, ends } = heldRunner(calls);
    // A yield bound is left: it does not fire, however long the run takes.
    const bound = { ...sideOf(calls, () => [wake("yield-bound", start + 5_000)]), clock };
    void counted.run([], {} as never);
    const point = quiet(bound);
    await turn(20);
    ends[0]?.();
    await point;
    expect(clock.now()).toBe(start);

    // A gather before every other wake is bookkeeping: time moves to it, and no further.
    let first = true;
    const gathers = () => {
      const pump = wake("pump", start + 500);
      const wakes = first ? [wake("slot-gather", start + 100), pump] : [pump];
      first = false;
      return wakes;
    };
    await quiet({ ...sideOf(calls, gathers), clock });
    expect(clock.now()).toBe(start + 100);
  });

  it("on the host's clock, waits through a gather, and a named wake only when told", async () => {
    // Each wake is left for the first two rests.
    const leftFor = (reason: string) => {
      let rests = 0;
      return () => (rests++ < 2 ? [wake(reason, Date.now() + 1_000)] : []);
    };
    const gather = sideOf(new RunnerCalls(), leftFor("slot-gather"));
    expect((await quiet(gather)).wakes).toEqual([]);
    expect(gather.rests).toBe(3);

    const claims = sideOf(new RunnerCalls(), leftFor("claims"));
    expect((await quiet(claims)).next?.reason).toBe("claims");
    expect(claims.rests).toBe(1);
    expect((await quiet(claims, { through: ["claims"] })).wakes).toEqual([]);
    expect(claims.rests).toBe(3);
  });

  it("on a scheduler, waits for the run its rest sets aside", { timeout: 60_000 }, async () => {
    const file = { path: "test/a.test.ts", ms: 1, realMs: 0, imports: ["src/a.ts"] };
    const repo = catchUpRepo([file]);
    const side = catchUpSide(repo, repo.main, {
      files: [file],
      hostSlots: 8,
      policy: RUN_MISSING,
      clock: "virtual",
    });
    await side.scheduler.start();
    await side.quiet();
    const base = side.runner.runs.length;
    file.realMs = 1_500;

    await side.edit("watch", "src/a.ts");
    await side.rest();
    // The discriminating read: a rest alone returns while the run goes on.
    expect(side.runner.active).toBe(1);
    const at = side.now();

    await side.quiet();
    expect(side.runner.active).toBe(0);
    expect(side.runner.runs.length).toBeGreaterThan(base);
    expect(side.runner.runs.every((run) => run.endedAt !== null)).toBe(true);
    expect(side.current(file.path)).toBe(true);
    expect(side.now()).toBe(at);
  });
});
