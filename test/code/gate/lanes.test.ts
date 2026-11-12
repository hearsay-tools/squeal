import { describe, expect, it } from "vitest";
import { SlotPool } from "../../../src/core/code/gate/lanes.js";

/*
 * Spec 020 D18 as amended (row 020-44): the pool every node:test entry's
 * processes come from. It never gives more slots than it holds, gives a
 * freed slot to the first waiter, drops a wait whose signal aborts, and
 * counts a release once.
 */

const live = () => new AbortController().signal;

describe("SlotPool", () => {
  it("gives its slots, then a freed one to the first waiter", async () => {
    const pool = new SlotPool(2);
    const first = await pool.take(live());
    const second = await pool.take(live());
    const order: string[] = [];
    const third = pool.take(live()).then((release) => {
      order.push("third");
      return release;
    });
    const fourth = pool.take(live()).then((release) => {
      order.push("fourth");
      return release;
    });
    await Promise.resolve();
    expect(order).toEqual([]);

    second?.();
    const given = await third;
    expect(order).toEqual(["third"]);
    first?.();
    await fourth;
    expect(order).toEqual(["third", "fourth"]);
    expect(given).not.toBeNull();
  });

  it("counts a release once", async () => {
    const pool = new SlotPool(1);
    const release = await pool.take(live());
    release?.();
    release?.();
    await pool.take(live());
    const waiting = new AbortController();
    const wait = pool.take(waiting.signal);
    waiting.abort();
    // A second release of the first slot freed nothing, so the wait is still waiting when aborted.
    expect(await wait).toBeNull();
  });

  it("answers null to a wait whose signal aborts, and skips it after", async () => {
    const pool = new SlotPool(1);
    const held = await pool.take(live());
    const stopping = new AbortController();
    const dropped = pool.take(stopping.signal);
    const next = pool.take(live());
    stopping.abort();
    expect(await dropped).toBeNull();
    held?.();
    expect(await next).not.toBeNull();
    expect(await pool.take(AbortSignal.abort())).toBeNull();
  });

  it("holds at least one slot", async () => {
    const pool = new SlotPool(0);
    expect(await pool.take(live())).not.toBeNull();
  });
});
