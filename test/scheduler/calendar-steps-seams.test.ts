import { describe, expect, it } from "vitest";
import { StatCache } from "../../src/core/hash/stat-cache.js";
import { testFileId } from "../../src/core/keys/reverse-index.js";
import { CalendarSteps, steppedClock } from "../../src/core/scheduler/calendar-steps.js";
import type { Clock } from "../../src/core/scheduler/clock.js";
import type { SchedulerContext } from "../../src/core/scheduler/context.js";
import { Ledger } from "../../src/core/scheduler/ledger.js";
import { Promotions } from "../../src/core/scheduler/promotions.js";
import { publishedBatches, publishPromotions } from "../../src/core/scheduler/promotions-row.js";
import { Priority } from "../../src/core/scheduler/queue.js";
import {
  BACKLOG_QUIET_MS,
  BacklogQuiet,
  publishedWaits,
  publishQuiet,
} from "../../src/core/scheduler/quiet.js";
import { SLOW_RELEASE_MS, SlowRelease } from "../../src/core/scheduler/slow-release.js";
import type { Tier } from "../../src/core/scheduler/tiers.js";
import { Wakes } from "../../src/core/scheduler/wakes.js";
import { TierYields, YIELD_REMAINDER_MS } from "../../src/core/scheduler/yields.js";
import type { EpochMs } from "../../src/core/types/common.js";
import type { CheckKey, TestFileRef } from "../../src/core/types/keys.js";
import { DEFAULT_POLICY } from "../../src/core/types/policy.js";
import { NO_TRAITS } from "../../src/core/types/runner-traits.js";
import type { Store } from "../../src/core/types/store.js";
import { type VirtualClock, virtualClock } from "../helpers/virtual-clock.js";
import { freshStore, WT } from "../state/helpers.js";

/*
 * Row 011-377, repair after review `reviews/0.1.524.md`. B1: after a
 * calendar step, the quiet and promotions rows a live daemon writes again
 * still read as its own in status (`publishedWaits`, `publishedBatches`),
 * and a predecessor's row is still rejected: the rows are stamped no
 * earlier than the daemon's start (`CalendarSteps.stamp`). B2: a step
 * between a wait's decision and its wake's delay adds nothing to the
 * delay: the clock steps on one chosen reading inside the call. S1 is
 * `calendar-steps-sample.test.ts`.
 */

const HOUR = 3_600_000;
const SHIFTS = [
  { shift: -HOUR, row: "set back 1 h" },
  { shift: HOUR, row: "set forward 1 h" },
];
const ref: TestFileRef = { project: "", path: "test/a.test.ts" };

/** A store whose worktree `WT` has the live daemon started at `startedAt`, as `Daemon` registers it. */
function liveStore(startedAt: EpochMs): Store {
  const store = freshStore();
  store.worktrees.upsert({
    id: WT,
    root: "/repo" as never,
    commonDir: "/repo/.git" as never,
    isMain: true,
    registeredAt: startedAt,
    daemon: null,
  });
  store.worktrees.setDaemon(WT, {
    socketPath: "/run/squeal.sock" as never,
    startedAt,
    heartbeatAt: startedAt,
    heartbeatIntervalMs: 60_000,
    squealVersion: "0.0.0-test",
    token: "t",
  });
  return store;
}

/** A daemon started at `startedAt` on `virtual`: its steps, which stamp its rows, and its clock. */
function daemonClock(virtual: VirtualClock, startedAt: EpochMs) {
  const steps = new CalendarSteps(() => startedAt);
  const clock = steppedClock(virtual, steps);
  clock.now();
  return { steps, clock };
}

describe("B1: a live daemon's rows still read as its own after a calendar step", () => {
  it.each(SHIFTS)("the quiet row, the calendar $row", ({ shift }) => {
    const virtual = virtualClock(10_000_000);
    const start = virtual.now();
    const store = liveStore(start);
    const { steps, clock } = daemonClock(virtual, start);
    const quiet = new BacklogQuiet((ends, at, catchUp) =>
      publishQuiet(store, WT as never, ends, steps.stamp(at), catchUp),
    );
    steps.onStep((ms, at) => quiet.shift(ms, at));
    virtual.advance(1_000);
    quiet.cancelled("a", clock.now());
    virtual.shiftCalendar(shift);
    virtual.advance(BACKLOG_QUIET_MS - 1);
    const now = clock.now();
    expect(quiet.waits("a", now)).toBe(true);
    // The row status reads: the lane's end, 1 ms ahead, in today's calendar.
    expect([...publishedWaits(store, WT as never, start, now).backlog]).toEqual([["a", now + 1]]);
  });

  it.each(SHIFTS)("the promotions row, the calendar $row", ({ shift }) => {
    const virtual = virtualClock(10_000_000);
    const start = virtual.now();
    const store = liveStore(start);
    const { steps, clock } = daemonClock(virtual, start);
    const promotions = new Promotions({
      now: clock.now,
      isRunning: () => false,
      publish: (live) => {
        const at = clock.now();
        publishPromotions(store, WT as never, live, steps.stamp(at));
      },
    });
    steps.onStep((ms) => promotions.shift(ms));
    virtual.advance(1_000);
    promotions.add([ref], clock.now() + 60_000, () => true);
    virtual.shiftCalendar(shift);
    const now = clock.now();
    expect(promotions.rankOf(testFileId(ref), now)).toBe(0);
    expect([...publishedBatches(store, WT as never, start, now).keys()]).toEqual([testFileId(ref)]);
  });

  it("a predecessor's row is still rejected, a set-back after its start too", () => {
    const virtual = virtualClock(10_000_000);
    const predecessor = virtual.now();
    const { steps, clock } = daemonClock(virtual, predecessor);
    virtual.advance(60_000);
    const start = virtual.now();
    const store = liveStore(start);
    // The predecessor writes once more after its successor started, the calendar set back first.
    virtual.shiftCalendar(-HOUR);
    const at = clock.now();
    publishQuiet(store, WT as never, new Map([["a", at + 20_000]]), steps.stamp(at));
    publishPromotions(
      store,
      WT as never,
      [{ files: [testFileId(ref)], until: at + 60_000 }],
      steps.stamp(at),
    );
    expect(steps.stamp(at)).toBe(predecessor);
    expect(publishedWaits(store, WT as never, start, at).backlog.size).toBe(0);
    expect(publishedBatches(store, WT as never, start, at).size).toBe(0);
  });
});

/** `virtual` under `steps`, whose calendar steps `shift` on the `nth` calendar reading after `count()` restarts. */
function steppingOn(virtual: VirtualClock, steps: CalendarSteps, nth: number, shift: number) {
  let reads = Number.NEGATIVE_INFINITY;
  const inner: Clock = {
    now: () => {
      reads += 1;
      if (reads === nth) virtual.shiftCalendar(shift);
      return virtual.now();
    },
    elapsed: () => virtual.elapsed(),
    arm: (ms, fire) => virtual.arm(ms, fire),
  };
  const clock = steppedClock(inner, steps);
  clock.now();
  return { clock, count: () => (reads = 0) };
}

describe("B2: a step between a wait's decision and its wake's delay adds nothing", () => {
  it.each(SHIFTS.flatMap(({ shift, row }) => [2, 3].map((nth) => ({ shift, nth, row }))))(
    "the slow release's idle bound, the calendar $row on reading $nth of `ended`",
    async ({ shift, nth }) => {
      const virtual = virtualClock(10_000_000);
      const steps = new CalendarSteps();
      const { clock, count } = steppingOn(virtual, steps, nth, shift);
      const wakes = new Wakes(clock);
      const released: string[] = [];
      const release = new SlowRelease({
        release: async (lane) => {
          released.push(lane);
        },
        lanes: () => [],
        now: () => clock.now(),
        closed: () => false,
        wakes,
      });
      steps.onStep((ms) => release.shift(ms));
      release.opened("slow:x");
      count();
      // Reading 1 stamps the lane's end; the decision and the wake's delay read after it.
      release.ended("slow:x");
      clock.now();
      expect(steps.total).toBe(shift);
      virtual.advance(SLOW_RELEASE_MS - 1);
      await wakes.rest();
      expect(released).toEqual([]);
      virtual.advance(1);
      await wakes.rest();
      expect(released).toEqual(["slow:x"]);
    },
  );
});

/**
 * `virtual` under `steps`, whose calendar steps `shift` once, on the first
 * reading taken inside a frame named `frame` after `trigger()`.
 */
function stepInside(virtual: VirtualClock, steps: CalendarSteps, frame: string, shift: number) {
  let waiting = false;
  const inner: Clock = {
    now: () => {
      if (waiting && (new Error().stack ?? "").includes(frame)) {
        waiting = false;
        virtual.shiftCalendar(shift);
      }
      return virtual.now();
    },
    elapsed: () => virtual.elapsed(),
    arm: (ms, fire) => virtual.arm(ms, fire),
  };
  const clock = steppedClock(inner, steps);
  clock.now();
  return { clock, trigger: () => (waiting = true), stepped: () => !waiting };
}

describe("B2: a step between the yield check and its bound's wake adds nothing", () => {
  it.each(SHIFTS)(
    "a 5 s estimate yields 30 s past it, the calendar $row inside `#arm`",
    ({ shift }) => {
      const virtual = virtualClock(10_000_000);
      const steps = new CalendarSteps();
      const { clock, trigger, stepped } = stepInside(virtual, steps, "TierYields.#arm", shift);
      const wakes = new Wakes(clock);
      const store = freshStore();
      const context = {
        store,
        worktreeId: WT,
        policy: DEFAULT_POLICY,
        now: clock.now,
        steps,
        runner: { traits: NO_TRAITS },
        keys: {
          cache: new StatCache(),
          isEnvironmentInput: () => false,
          runnerOf: () => undefined,
        },
      } as unknown as SchedulerContext;
      const ledger = new Ledger(context);
      // A named wait's file, queued and promoted: the tier past its estimate yields for it.
      const named = { project: "", path: "test/named.test.ts" };
      const file = ledger.addFile(named);
      file.key = "n".padEnd(64, "0") as CheckKey;
      ledger.enqueue(file, Priority.edited, false, true);
      ledger.queue.promote([named], clock.now() + 600_000);
      const files = ["test/a.test.ts", "test/b.test.ts"].map((path, i) => {
        const one = ledger.addFile({ project: "", path });
        one.key = `run-a${i}`.padEnd(64, "0") as CheckKey;
        one.durationMs = 5_000;
        return { file: one, key: one.key, inputs: [path], checkpointId: null, forced: false };
      });
      const tier = {
        runId: "run-a",
        lane: "",
        kind: "edit",
        files,
        changes: new Set(),
        revision: { number: 1 },
        startedAt: clock.now(),
        startedStep: steps.total,
        cancel: new AbortController(),
      } as unknown as Tier;
      const yields = new TierYields(
        () => yields.check(context, ledger, [tier], null, false),
        wakes,
      );
      steps.onStep((ms) => {
        ledger.queue.shift(ms);
        yields.shift(ms);
      });
      virtual.advance(5_000 + 20_000);
      trigger();
      yields.check(context, ledger, [tier], null, false);
      expect(stepped()).toBe(true);
      virtual.advance(YIELD_REMAINDER_MS - 20_000 - 1);
      expect(tier.cancel?.signal.aborted).toBe(false);
      virtual.advance(1);
      expect(tier.cancel?.signal.reason).toBe("yield");
      store.close();
    },
  );
});
