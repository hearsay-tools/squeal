import { describe, expect, it } from "vitest";
import { SlicedWrites } from "../../src/core/daemon/sliced-writes.js";
import { BusyWaits } from "../../src/core/store/index.js";
import { waitFor } from "./helpers.js";

/*
 * Task 001-422: the heartbeat's writes on a busy store give up after a
 * slice, are retried soon, and a tick while a retry is pending is the
 * retry's: coalesced, never stacked.
 */

const busy = () => Object.assign(new Error("database is locked"), { errcode: 5 });

describe("the timers' writes on a busy store (001-422)", () => {
  it("retry the whole group once, coalescing ticks, then note the episode", async () => {
    const notes: string[] = [];
    const logs: string[] = [];
    const busyWaits = new BusyWaits({ now: Date.now, note: (text) => notes.push(text) });
    const writes = new SlicedWrites({ log: (line) => logs.push(line), busyWaits });
    const calls: string[] = [];
    let locked = true;
    const group = [
      ["heartbeat", () => calls.push("heartbeat")],
      [
        "harness check",
        () => {
          calls.push("harness");
          if (locked) throw busy();
        },
      ],
      ["leaving check", () => calls.push("leaving")],
    ] as const;
    writes.run("the heartbeat", group);
    writes.run("the heartbeat", group);
    writes.run("the heartbeat", group);
    expect(calls).toEqual(["heartbeat", "harness"]);
    // The heartbeat landed before the harness check gave up; the retry writes it again (001-422).
    await waitFor(() => calls.length >= 4, 5_000, "a retry");
    expect(calls.slice(2, 4)).toEqual(["heartbeat", "harness"]);
    locked = false;
    await waitFor(() => calls.includes("leaving"), 5_000, "the retry that lands");
    expect(calls.slice(-3)).toEqual(["heartbeat", "harness", "leaving"]);
    const beats = calls.filter((c) => c === "heartbeat").length;
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatch(/ran once it was free: the heartbeat$/);
    expect(logs).toEqual([]);

    writes.run("the heartbeat", group);
    expect(calls.filter((c) => c === "heartbeat")).toHaveLength(beats + 1);
    expect(notes).toHaveLength(1);
    writes.stop();
  });

  it("runs another group behind a pending retry, not beside it", async () => {
    const notes: string[] = [];
    const busyWaits = new BusyWaits({ now: Date.now, note: (text) => notes.push(text) });
    const writes = new SlicedWrites({ log: () => {}, busyWaits });
    const calls: string[] = [];
    let locked = true;
    writes.run("the heartbeat", [
      [
        "heartbeat",
        () => {
          calls.push("heartbeat");
          if (locked) throw busy();
        },
      ],
    ]);
    writes.run("consumer expiry", [["consumer expiry", () => calls.push("expiry")]]);
    expect(calls).toEqual(["heartbeat"]);
    locked = false;
    await waitFor(() => calls.includes("expiry"), 5_000, "the shared retry");
    expect(calls).toEqual(["heartbeat", "heartbeat", "expiry"]);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatch(/ran once it was free: the heartbeat, consumer expiry$/);
    writes.stop();
  });

  it("logs any other failure and goes on with the group", () => {
    const logs: string[] = [];
    const busyWaits = new BusyWaits({ now: Date.now, note: () => {} });
    const writes = new SlicedWrites({ log: (line) => logs.push(line), busyWaits });
    const calls: string[] = [];
    writes.run("the heartbeat", [
      [
        "heartbeat",
        () => {
          throw new Error("disk I/O error");
        },
      ],
      ["leaving check", () => calls.push("leaving")],
    ]);
    expect(logs).toEqual(["heartbeat failed: Error: disk I/O error"]);
    expect(calls).toEqual(["leaving"]);
  });

  it("stops its pending retry", async () => {
    const writes = new SlicedWrites({
      log: () => {},
      busyWaits: new BusyWaits({ now: Date.now, note: () => {} }),
    });
    let calls = 0;
    writes.run("consumer expiry", [
      [
        "consumer expiry",
        () => {
          calls++;
          throw busy();
        },
      ],
    ]);
    writes.stop();
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(calls).toBe(1);
  });
});
