import { describe, expect, it } from "vitest";
import { awaitVerdict, giveVerdict, verdictSlot } from "../../../src/harness/pi/host.js";

/*
 * Row 011-288: the worker waits in its verdict slot for the host's verdict
 * on one held answer; only that answer's verdict, given while it waits,
 * ends the wait as given.
 */

describe("the Pi verdict slot (row 011-288)", () => {
  it("is the verdict the host gives while the worker waits for that answer", () => {
    const slot = new Int32Array(verdictSlot());
    expect(awaitVerdict(slot, 7, 1_000, () => giveVerdict(slot, 7, "commit"))).toBe("commit");
    expect(awaitVerdict(slot, 8, 1_000, () => giveVerdict(slot, 8, "abandon"))).toBe("abandon");
    expect(Atomics.load(slot, 0)).toBe(0);
  });

  it("is abandon at the bound, when no verdict or another answer's came", () => {
    const slot = new Int32Array(verdictSlot());
    giveVerdict(slot, 9, "commit");
    expect(awaitVerdict(slot, 9, 20, () => giveVerdict(slot, 10, "commit"))).toBe("abandon");
    // A verdict given once the wait ended lands nowhere.
    giveVerdict(slot, 9, "commit");
    expect(Atomics.load(slot, 0)).toBe(0);
  });

  it("is abandon when the answer cannot be posted", () => {
    const slot = new Int32Array(verdictSlot());
    const post = () => {
      throw new Error("not cloneable");
    };
    expect(awaitVerdict(slot, 11, 1_000, post)).toBe("abandon");
    expect(Atomics.load(slot, 0)).toBe(0);
  });
});
