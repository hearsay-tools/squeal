import { describe, expect, it } from "vitest";
import type { Clock } from "../../src/core/scheduler/clock.js";
import { Mutex } from "../../src/core/scheduler/mutex.js";
import { WAKE_ORDER, type WakeReason } from "../../src/core/scheduler/step-events.js";
import { Wakes } from "../../src/core/scheduler/wakes.js";
import type { EpochMs } from "../../src/core/types/common.js";
import { virtualClock } from "../helpers/virtual-clock.js";

/*
 * Row 011-352 (card 7, `research/scheduler-step.md`, "The wake loop"): one
 * timer at the earliest wake, owners due together in the written order, one
 * reading per pass, and the rest signal.
 */

const at = (ms: number) => ms as EpochMs;

/** A loop on a virtual clock that counts its readings and arms; `fired` lists each owner's run. */
function loop(start = 0) {
  const clock = virtualClock(at(start));
  let readings = 0;
  let arms = 0;
  const counted: Clock = {
    now: () => {
      readings += 1;
      return clock.now();
    },
    arm: (ms, fire) => {
      arms += 1;
      return clock.arm(ms, fire);
    },
  };
  const wakes = new Wakes(counted);
  const fired: string[] = [];
  const slot = (reason: WakeReason, name: string = reason, rank?: number) =>
    wakes.slot(
      reason,
      (reading) => fired.push(`${name}@${reading}`),
      rank === undefined ? {} : { rank },
    );
  return {
    clock,
    wakes,
    fired,
    slot,
    readings: () => readings,
    arms: () => arms,
  };
}

/** Whether `rest` resolves before `ms` of real time pass. */
async function rests(wakes: Wakes, ms = 30): Promise<boolean> {
  const timeout = new Promise<false>((resolve) => setTimeout(() => resolve(false), ms));
  return Promise.race([wakes.rest().then(() => true as const), timeout]);
}

describe("the wake loop (row 011-352)", () => {
  it("arms one timer at the earliest wake; a later one does not re-arm, an earlier one does", () => {
    const { clock, slot, fired, arms } = loop();
    slot("pump").at(at(500));
    slot("claims").at(at(900));
    expect(clock.armed).toBe(1);
    expect(arms()).toBe(1);
    slot("slow-release").at(at(200));
    expect(clock.armed).toBe(1);
    expect(arms()).toBe(2);
    clock.advance(199);
    expect(fired).toEqual([]);
    clock.advance(1);
    expect(fired).toEqual(["slow-release@200"]);
    clock.advance(1_000);
    expect(fired).toEqual(["slow-release@200", "pump@500", "claims@900"]);
    expect(clock.armed).toBe(0);
  });

  it("a wake in the past fires at the next pass, with no wait", () => {
    const { clock, slot, fired } = loop(1_000);
    slot("yield-bound").at(at(400));
    expect(clock.armed).toBe(1);
    clock.advance(0);
    expect(fired).toEqual(["yield-bound@1000"]);
  });

  it("owners due at one time run in the written order, whatever order they were stated in", () => {
    const { clock, slot, fired } = loop();
    const reasons = [...WAKE_ORDER].reverse();
    for (const reason of reasons) slot(reason).at(at(100));
    // Two slow lanes: the configured one first, the default `slow` (rank 1) last.
    slot("slow-lane", "slow", 1).at(at(100));
    slot("slow-lane", "group:e2e", 0).at(at(100));
    clock.advance(100);
    expect(fired.map((line) => line.split("@")[0])).toEqual([
      "command-hold",
      "merge-hold",
      "yield-bound",
      "slow-release",
      "slow-lane",
      "group:e2e",
      "slow",
      "slot-gather",
      "claims",
      "runner-part-bound",
      "pump",
    ]);
  });

  it("a pass takes one reading, which each due owner gets, and arms the next from it", () => {
    const { clock, slot, fired, readings, wakes } = loop();
    slot("merge-hold").at(at(50));
    slot("claims").at(at(40));
    const hold = wakes.slot("command-hold", (reading) => {
      fired.push(`hold@${reading}`);
      hold.at(at(reading + 1_000));
    });
    hold.at(at(30));
    const before = readings();
    clock.advance(60);
    // Three passes (30, 40, 50): one reading each, none to arm.
    expect(readings() - before).toBe(3);
    expect(fired).toEqual(["hold@30", "claims@40", "merge-hold@50"]);
    expect(clock.armed).toBe(1);
    clock.advance(1_000);
    expect(fired.at(-1)).toBe("hold@1030");
  });

  it("an owner that moves another past the reading holds it to its new wake", () => {
    const { clock, slot, fired, wakes } = loop();
    const pump = slot("pump");
    wakes.slot("command-hold", () => pump.at(at(300))).at(at(100));
    pump.at(at(100));
    clock.advance(100);
    expect(fired).toEqual([]);
    clock.advance(200);
    expect(fired).toEqual(["pump@300"]);
  });

  it("clearing the earliest wake re-arms at the next; clearing the last and closing disarm", () => {
    const { clock, slot, fired, wakes } = loop();
    const first = slot("claims");
    const second = slot("pump");
    first.at(at(100));
    second.at(at(200));
    first.clear();
    expect(clock.armed).toBe(1);
    clock.advance(150);
    expect(fired).toEqual([]);
    second.clear();
    expect(clock.armed).toBe(0);
    second.at(at(400));
    expect(clock.armed).toBe(1);
    wakes.close();
    expect(clock.armed).toBe(0);
    second.at(at(500));
    clock.advance(1_000);
    expect(fired).toEqual([]);
    expect(clock.armed).toBe(0);
  });

  it("a dropped slot leaves the loop; atMost keeps the earlier wake", () => {
    const { clock, slot, fired, wakes } = loop();
    const bound = slot("runner-part-bound");
    bound.at(at(100));
    bound.atMost(at(300));
    expect(bound.wake).toBe(100);
    bound.atMost(at(50));
    expect(bound.wake).toBe(50);
    bound.drop();
    bound.at(at(60));
    expect(clock.armed).toBe(0);
    expect(wakes.wakes()).toEqual([]);
    clock.advance(1_000);
    expect(fired).toEqual([]);
  });

  it("an owner's throw runs the others and is thrown after the pass, which still re-arms", () => {
    const { clock, slot, fired, wakes } = loop();
    wakes
      .slot("command-hold", () => {
        throw new Error("boom");
      })
      .at(at(10));
    slot("pump").at(at(10));
    slot("claims").at(at(20));
    expect(() => clock.advance(10)).toThrow("boom");
    expect(fired).toEqual(["pump@10"]);
    expect(clock.armed).toBe(1);
  });
});

describe("the rest signal (row 011-352)", () => {
  it("rests with nothing to do and reports the next wake and each owner's", async () => {
    const { wakes, slot } = loop();
    slot("pump").at(at(2_000));
    slot("claims").at(at(250));
    await expect(wakes.rest()).resolves.toEqual({
      next: { reason: "claims", at: 250 },
      wakes: [
        { reason: "claims", at: 250 },
        { reason: "pump", at: 2_000 },
      ],
    });
  });

  it("does not rest while a wake is due; the pass that runs it ends the wait", async () => {
    const { wakes, slot, clock, fired } = loop(100);
    slot("pump").at(at(100));
    const rest = wakes.rest();
    expect(await rests(wakes)).toBe(false);
    clock.advance(0);
    await expect(rest).resolves.toEqual({ next: null, wakes: [] });
    expect(fired).toEqual(["pump@100"]);
  });

  it("does not rest under tracked work, nor under the work it starts as it ends", async () => {
    const { wakes } = loop();
    let end = () => {};
    const work = wakes.track(new Promise<void>((resolve) => (end = resolve)));
    let followed = false;
    void work.then(() => {
      // Work started in the reaction to the first: within one setImmediate of its end.
      void wakes.track(
        new Promise<void>((resolve) =>
          setImmediate(() => {
            followed = true;
            resolve();
          }),
        ),
      );
    });
    expect(await rests(wakes)).toBe(false);
    end();
    await wakes.rest();
    expect(followed).toBe(true);
  });

  it("does not rest while the lock has a task queued or running", async () => {
    const { wakes } = loop();
    const lock = new Mutex(undefined, (count) => wakes.locked(count));
    let release = () => {};
    const held = lock.run(() => new Promise<void>((resolve) => (release = resolve)));
    const queued = lock.run(() => {});
    expect(await rests(wakes)).toBe(false);
    release();
    await wakes.rest();
    await Promise.all([held, queued]);
  });

  it("a runner's run set aside counts as rest; its end does not", async () => {
    const { wakes } = loop();
    let end = () => {};
    const run = new Promise<string>((resolve) => (end = () => resolve("ran")));
    let recorded = false;
    let finish = () => {};
    void wakes.track(
      (async () => {
        await wakes.aside(run);
        // What follows the run, a record, is the scheduler's own work again.
        await new Promise<void>((resolve) => (finish = resolve));
        recorded = true;
      })(),
    );
    await wakes.rest();
    end();
    expect(await rests(wakes)).toBe(false);
    finish();
    await wakes.rest();
    expect(recorded).toBe(true);
  });

  it("a closed loop rests once its tracked work ends, past wakes or not", async () => {
    const { wakes, slot } = loop(100);
    slot("pump").at(at(50));
    wakes.close();
    await expect(wakes.rest()).resolves.toEqual({
      next: { reason: "pump", at: 50 },
      wakes: [{ reason: "pump", at: 50 }],
    });
  });
});
