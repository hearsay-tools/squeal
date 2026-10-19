import { describe, expect, it, onTestFinished } from "vitest";
import { Mutex } from "../../src/core/scheduler/mutex.js";
import { SlotRecords } from "../../src/core/scheduler/slot-records.js";

/*
 * Task 011-21 slice 2: the records of backlog slots that end together share
 * one commit, and a failure fails only the slots it reached.
 */
function records(options: { failCommit?: boolean } = {}) {
  const commits: string[][] = [];
  let open: string[] = [];
  const slots = new SlotRecords<string, string>({
    lock: new Mutex(),
    record: async (ended) => {
      if (ended === "bad") throw new Error("record failed");
      open.push(ended);
      return `recorded ${ended}`;
    },
    commit: () => {
      if (options.failCommit === true) throw new Error("commit failed");
      commits.push(open);
      open = [];
    },
  });
  return { slots, commits };
}

const later = <T>(value: T, ms: number) =>
  new Promise<T>((resolve) => setTimeout(() => resolve(value), ms));

describe("SlotRecords (task 011-21 slice 2)", () => {
  it("commits the slots that end within the gather once, each with its own record", async () => {
    const { slots, commits } = records();
    const outcomes = await Promise.all([
      slots.record(Promise.resolve("a")),
      slots.record(later("b", 5)),
      slots.record(Promise.resolve("c")),
    ]);
    expect(outcomes).toEqual(["recorded a", "recorded b", "recorded c"]);
    expect(commits).toEqual([["a", "b", "c"]]);
  });

  it("records a slot that ends after the commit in the next one", async () => {
    const { slots, commits } = records();
    const first = slots.record(Promise.resolve("a"));
    await first;
    await slots.record(Promise.resolve("b"));
    expect(commits).toEqual([["a"], ["b"]]);
  });

  it("fails only the slot whose record failed", async () => {
    const { slots, commits } = records();
    const [good, bad] = await Promise.allSettled([
      slots.record(Promise.resolve("a")),
      slots.record(Promise.resolve("bad")),
    ]);
    expect(good).toEqual({ status: "fulfilled", value: "recorded a" });
    expect(bad).toMatchObject({ status: "rejected", reason: new Error("record failed") });
    expect(commits).toEqual([["a"]]);
  });

  it("fails every slot a failed commit held, and a slot whose reads failed", async () => {
    const { slots } = records({ failCommit: true });
    const outcomes = await Promise.allSettled([
      slots.record(Promise.resolve("a")),
      slots.record(Promise.resolve("b")),
      slots.record(Promise.reject(new Error("reads failed"))),
    ]);
    expect(outcomes.map((o) => (o.status === "rejected" ? String(o.reason) : o.value))).toEqual([
      "Error: commit failed",
      "Error: commit failed",
      "Error: reads failed",
    ]);
  });

  it("leaves no rejection unhandled while a later slot's reads are pending (review wave-4 slice 2, B1)", async () => {
    const unhandled: unknown[] = [];
    const listen = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", listen);
    onTestFinished(() => {
      process.off("unhandledRejection", listen);
    });
    const { slots, commits } = records();
    const outcomes = Promise.allSettled([
      slots.record(Promise.resolve("bad")),
      slots.record(later("b", 50)),
    ]);
    const [bad, good] = await outcomes;
    // An unhandled rejection is reported after the turn it happened in.
    await later(null, 10);
    expect(unhandled).toEqual([]);
    expect(bad).toMatchObject({ status: "rejected", reason: new Error("record failed") });
    expect(good).toEqual({ status: "fulfilled", value: "recorded b" });
    expect(commits).toEqual([["b"]]);
  });
});
