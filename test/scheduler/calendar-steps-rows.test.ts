import { describe, expect, it } from "vitest";
import { StatCache } from "../../src/core/hash/stat-cache.js";
import { CalendarSteps, steppedClock } from "../../src/core/scheduler/calendar-steps.js";
import type { Clock } from "../../src/core/scheduler/clock.js";
import type { SchedulerContext } from "../../src/core/scheduler/context.js";
import { Ledger } from "../../src/core/scheduler/ledger.js";
import {
  PoolWaits,
  poolWaitMetaKey,
  poolWaitsPublish,
  publishedPoolWaits,
} from "../../src/core/scheduler/pool-wait.js";
import type { Tier } from "../../src/core/scheduler/tiers.js";
import { Wakes } from "../../src/core/scheduler/wakes.js";
import { publishedYieldRow, TierYields, yieldsMetaKey } from "../../src/core/scheduler/yields.js";
import type { EpochMs } from "../../src/core/types/common.js";
import type { CheckKey } from "../../src/core/types/keys.js";
import { DEFAULT_POLICY } from "../../src/core/types/policy.js";
import { NO_TRAITS } from "../../src/core/types/runner-traits.js";
import type { PoolGate } from "../../src/core/types/standing.js";
import type { Store } from "../../src/core/types/store.js";
import { type VirtualClock, virtualClock } from "../helpers/virtual-clock.js";
import { freshStore, WT } from "../state/helpers.js";

/*
 * Row 011-386: the yield rows and the pool's wait rows a live daemon writes
 * after a calendar step still read as its own in status
 * (`publishedYieldRow`, `publishedPoolWaits`), and a predecessor's row is
 * still rejected: both are stamped no earlier than the daemon's start
 * (`CalendarSteps.stamp`), as the quiet and promotions rows are
 * (`calendar-steps-seams.test.ts`, review 0.1.524 B1).
 */

const HOUR = 3_600_000;
const SHIFTS = [
  { shift: -HOUR, row: "set back 1 h" },
  { shift: HOUR, row: "set forward 1 h" },
];
const GATE: PoolGate = { busyCores: 20, cpus: 24, hostSlots: 12, grants: 12 };

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

/** The pool-wait owner as the scheduler wires it, writing to `store` for the daemon of `steps`. */
function poolWaits(store: Store, steps: CalendarSteps, now: () => number): PoolWaits {
  return new PoolWaits({
    now,
    log: () => {},
    publish: poolWaitsPublish(store, WT as never, steps),
  });
}

/** A yield owner for the daemon of `steps`, and a two-file tier of which one file has ended. */
function yieldOwner(store: Store, steps: CalendarSteps, clock: Clock) {
  const now = clock.now;
  const context = {
    store,
    worktreeId: WT,
    policy: DEFAULT_POLICY,
    now,
    steps,
    runner: { traits: NO_TRAITS },
    keys: { cache: new StatCache(), isEnvironmentInput: () => false, runnerOf: () => undefined },
  } as unknown as SchedulerContext;
  const ledger = new Ledger(context);
  const files = ["test/a.test.ts", "test/b.test.ts"].map((path, i) => {
    const one = ledger.addFile({ project: "", path });
    one.key = `run-a${i}`.padEnd(64, "0") as CheckKey;
    return { file: one, key: one.key, inputs: [path], checkpointId: null, forced: false };
  });
  const tier = {
    runId: "run-a",
    lane: "",
    kind: "edit",
    files,
    changes: new Set(),
    revision: { number: 1 },
    startedAt: now(),
    startedStep: steps.total,
    ended: new Set([files[0]?.file.id]),
    cancel: new AbortController(),
  } as unknown as Tier;
  const yields = new TierYields(() => {}, new Wakes(clock));
  return { context, tier, yields };
}

describe("row 011-386: a live daemon's rows still read as its own after a calendar step", () => {
  it.each(SHIFTS)("the yield row, the calendar $row", ({ shift }) => {
    const virtual = virtualClock(10_000_000);
    const start = virtual.now();
    const store = liveStore(start);
    const { steps, clock } = daemonClock(virtual, start);
    const { context, tier, yields } = yieldOwner(store, steps, clock);
    virtual.advance(1_000);
    virtual.shiftCalendar(shift);
    // The first write after the step: the tier's ended count.
    yields.fileEnded(context, tier);
    const row = publishedYieldRow(store, WT as never, start);
    expect(row.at).toBe(Math.max(clock.now(), start));
    expect(row.ended.get("run-a")).toBe(1);
    store.close();
  });

  it.each(SHIFTS)("the pool's wait row, the calendar $row", ({ shift }) => {
    const virtual = virtualClock(10_000_000);
    const start = virtual.now();
    const store = liveStore(start);
    const { steps, clock } = daemonClock(virtual, start);
    const waits = poolWaits(store, steps, clock.now);
    virtual.advance(1_000);
    virtual.shiftCalendar(shift);
    // The lane's first refusal after the step writes the row.
    waits.refused("", GATE);
    const now = clock.now();
    expect([...publishedPoolWaits(store, WT as never, start, now).keys()]).toEqual([""]);
    store.close();
  });

  it("a predecessor's rows are still rejected, a set-back after its start too", () => {
    const virtual = virtualClock(10_000_000);
    const predecessor = virtual.now();
    const { steps, clock } = daemonClock(virtual, predecessor);
    virtual.advance(60_000);
    const start = virtual.now();
    const store = liveStore(start);
    const { context, tier, yields } = yieldOwner(store, steps, clock);
    const waits = poolWaits(store, steps, clock.now);
    // The predecessor writes once more after its successor started, the calendar set back first.
    virtual.shiftCalendar(-HOUR);
    yields.fileEnded(context, tier);
    waits.refused("", GATE);
    const now = clock.now();
    // Both rows were written, and stamped with the predecessor's start.
    expect(JSON.parse(store.meta.get(yieldsMetaKey(WT as never)) ?? "{}").at).toBe(predecessor);
    expect(JSON.parse(store.meta.get(poolWaitMetaKey(WT as never)) ?? "{}").at).toBe(predecessor);
    expect(publishedYieldRow(store, WT as never, start).at).toBeUndefined();
    expect(publishedPoolWaits(store, WT as never, start, now).size).toBe(0);
    store.close();
  });
});
