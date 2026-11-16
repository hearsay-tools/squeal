import { describe, expect, it } from "vitest";
import type { EpochMs } from "../../src/core/types/common.js";
import type { Rest, RestWake } from "../../src/core/types/scheduler.js";
import { RunnerCalls } from "../helpers/quiet-point.js";
import { virtualClock } from "../helpers/virtual-clock.js";
import type { CatchUpSide } from "./catch-up-fixture.js";
import { settle } from "./tier-yields-fixture.js";

/*
 * Row 011-368, review `reviews/011-363-367.md` S1: `settle` moves the clock
 * to a record's gather (`slot-gather`) only while no other wake is due at
 * or before it, so a yield bound or a recheck a test means to stay before
 * never fires inside a settle. A side here is its clock and pending wakes
 * only, with no runs.
 */

/** A side at 0 on a virtual clock with `wakes` armed; `fired` lists their reasons as they fire. */
function sideOf(wakes: readonly RestWake[]) {
  const clock = virtualClock(0 as EpochMs);
  const fired: string[] = [];
  const pending = new Set(wakes);
  for (const wake of wakes) {
    clock.arm(wake.at, () => {
      pending.delete(wake);
      fired.push(wake.reason);
    });
  }
  const rest = async (): Promise<Rest> => {
    const left = [...pending].sort((a, b) => a.at - b.at);
    return { next: left[0] ?? null, wakes: left, busyResume: false };
  };
  const side = {
    calls: new RunnerCalls(),
    clock,
    now: () => clock.now(),
    advance: (ms: number) => clock.advance(ms),
    rest,
  } as unknown as CatchUpSide;
  return { side, clock, fired };
}

const wake = (reason: string, at: number): RestWake => ({ reason, at: at as EpochMs });

describe("settle moves time only to a gather that no other wake precedes (review 011-363-367 S1)", () => {
  it("stays before an earlier yield bound and the gather after it", async () => {
    const { side, clock, fired } = sideOf([wake("yield-bound", 10), wake("slot-gather", 25)]);
    await settle(side);
    expect(clock.now()).toBe(0);
    expect(fired).toEqual([]);
  });

  it("stays before a gather due with another wake at the same time", async () => {
    const { side, clock, fired } = sideOf([wake("claim-recheck", 25), wake("slot-gather", 25)]);
    await settle(side);
    expect(clock.now()).toBe(0);
    expect(fired).toEqual([]);
  });

  it("moves to each gather before the first other wake, and stops there", async () => {
    const { side, clock, fired } = sideOf([
      wake("slot-gather", 5),
      wake("slot-gather", 8),
      wake("yield-bound", 10),
      wake("slot-gather", 25),
    ]);
    await settle(side);
    expect(clock.now()).toBe(8);
    expect(fired).toEqual(["slot-gather", "slot-gather"]);
  });
});
