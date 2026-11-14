import { describe, expect, it } from "vitest";
import { EarlyWrites, type PassEnd, type Pause } from "../../../src/core/code/gate/keep-queue.js";

/*
 * Row 020-66 (review 0.1.499 S1): `stop` called in the same turn as a
 * pause's release starts no pass. The pause's `then` resolves the loop's
 * wait, but the loop resumes only on a later microtask; `stop` sets its
 * flag first, and the loop must see it. The order is driven through the
 * `Pause` seam, never by a timer.
 */

/** A pause the case ends by hand: `end` calls the keeper's `then`. */
function heldPause() {
  let then: (() => void) | null = null;
  let asked!: () => void;
  const askedP = new Promise<void>((resolve) => {
    asked = resolve;
  });
  const pause: Pause = (_ms, next) => {
    then = next;
    asked();
    return () => {
      then = null;
    };
  };
  const end = () => {
    if (then === null) throw new Error("no pause under way");
    then();
  };
  return { pause, asked: askedP, end };
}

describe("EarlyWrites stop after a pause's release (row 020-66)", () => {
  it("starts no pass when stop follows the release in the same turn", async () => {
    const held = heldPause();
    let passes = 0;
    const writes = new EarlyWrites(async (): Promise<PassEnd> => {
      passes += 1;
      return "left";
    }, held.pause);
    writes.kick();
    await held.asked;
    expect(passes).toBe(1);

    held.end();
    await writes.stop();

    expect(passes).toBe(1);
  });

  it("still starts the next pass when the release comes with no stop", async () => {
    const held = heldPause();
    let passes = 0;
    const writes = new EarlyWrites(async (): Promise<PassEnd> => {
      passes += 1;
      return passes === 1 ? "left" : "done";
    }, held.pause);
    writes.kick();
    await held.asked;
    held.end();
    for (let i = 0; i < 10 && passes < 2; i++) await Promise.resolve();
    expect(passes).toBe(2);
    await writes.stop();
  });
});
