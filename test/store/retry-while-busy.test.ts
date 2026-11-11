import { describe, expect, it } from "vitest";
import { BusyWaits, retryWhileBusy } from "../../src/core/store/busy.js";

/*
 * Spec 021 D2 (row 021-08): the shared loop of the daemon's retried writes.
 * A refusal is tried again and told to `BusyWaits` once; any other error,
 * or a refusal once the caller stopped, is thrown at once.
 */

const busy = () => Object.assign(new Error("database is locked"), { errcode: 5 });

function waits(): { waits: BusyWaits; notes: string[] } {
  const notes: string[] = [];
  return { waits: new BusyWaits({ now: Date.now, note: (text) => notes.push(text) }), notes };
}

describe("retryWhileBusy (spec 021 D2)", () => {
  it("tries a refused write again until it lands; one note names it", async () => {
    const { waits: told, notes } = waits();
    const tries: number[] = [];
    const result = await retryWhileBusy(
      async (n) => {
        tries.push(n);
        if (n < 2) throw busy();
        return "landed";
      },
      { waits: told, key: "k", what: "the write", stopped: () => false },
    );
    expect(result).toBe("landed");
    expect(tries).toEqual([0, 1, 2]);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatch(/: the write$/);
  });

  it("throws another error at once, with no note", async () => {
    const { waits: told, notes } = waits();
    let tries = 0;
    const failing = retryWhileBusy(
      async () => {
        tries++;
        throw new Error("not a busy store");
      },
      { waits: told, key: "k", what: "the write", stopped: () => false },
    );
    await expect(failing).rejects.toThrow("not a busy store");
    expect(tries).toBe(1);
    expect(notes).toEqual([]);
  });

  it("throws the refusal once stopped; what never ran leaves no note", async () => {
    const { waits: told, notes } = waits();
    let stopped = false;
    const refused = retryWhileBusy(
      async (n) => {
        if (n === 1) stopped = true;
        throw busy();
      },
      { waits: told, key: "k", what: "the write", stopped: () => stopped },
    );
    await expect(refused).rejects.toThrow("database is locked");
    expect(notes).toEqual([]);
  });
});
