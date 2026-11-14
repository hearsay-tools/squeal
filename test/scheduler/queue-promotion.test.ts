import { describe, expect, it } from "vitest";
import { testFileId } from "../../src/core/keys/reverse-index.js";
import {
  Priority,
  RECENT_TIERS_PER_BACKLOG_TIER,
  RunQueue,
} from "../../src/core/scheduler/queue.js";
import type { TestFileRef } from "../../src/core/types/keys.js";

const ref = (name: string): TestFileRef => ({ project: "", path: `test/${name}.test.ts` });
const names = (refs: readonly TestFileRef[]) =>
  refs.map((r) => r.path.replace(/^test\/|\.test\.ts$/g, ""));

/** A queue on a clock the test moves, with the running files it names. */
function queueAt() {
  const clock = { now: 1_000 };
  const running = new Set<string>();
  const queue = new RunQueue();
  queue.setPromotionClock(
    () => clock.now,
    (r) => running.has(testFileId(r)),
  );
  return { queue, clock, running };
}

describe("RunQueue promotion (spec 011 C15)", () => {
  it("issue 14: with B and Z queued, a promoted Z goes before B, and B stays queued", () => {
    const { queue, clock } = queueAt();
    queue.add(ref("b"), Priority.neverRun);
    queue.add(ref("z"), Priority.neverRun);
    expect(names(queue.ordered())).toEqual(["b", "z"]);
    queue.promote([ref("z")], clock.now + 60_000);
    expect(names(queue.ordered())).toEqual(["z", "b"]);
    expect(queue.isPromoted(ref("z"))).toBe(true);
    expect(queue.isRecent(ref("z"))).toBe(false);
  });

  it("leads the first group, failing and edited files included; the earlier request first", () => {
    const { queue, clock } = queueAt();
    queue.add(ref("failing"), Priority.failing, false, true);
    queue.add(ref("edited"), Priority.direct, false, true);
    queue.add(ref("y"), Priority.transitive);
    queue.add(ref("z"), Priority.neverRun);
    queue.add(ref("backlog"), Priority.failing);
    queue.promote([ref("z")], clock.now + 60_000);
    queue.promote([ref("y"), ref("z")], clock.now + 60_000);
    expect(names(queue.ordered())).toEqual(["z", "y", "failing", "edited", "backlog"]);
  });

  it("lasts past the deadline while its file is queued, as a batch (row 011-268)", () => {
    const { queue, clock } = queueAt();
    queue.add(ref("b"), Priority.neverRun);
    queue.add(ref("z"), Priority.neverRun);
    queue.promote([ref("z")], clock.now + 5_000);
    clock.now += 5_000;
    // Before row 011-268 it ended here: B first again, Z of the second group.
    expect(names(queue.ordered())).toEqual(["z", "b"]);
    expect(queue.isFirstGroup(ref("z"))).toBe(true);
    queue.remove(ref("z"));
    queue.add(ref("z"), Priority.direct);
    // Z left the queue and its batch ended: queued again after the deadline, it is no batch's.
    expect(queue.isPromoted(ref("z"))).toBe(false);
  });

  it("promotes a file queued again while another selected file is open, not once all settled", () => {
    const { queue, clock, running } = queueAt();
    queue.add(ref("b"), Priority.neverRun);
    queue.add(ref("y"), Priority.neverRun);
    queue.add(ref("z"), Priority.neverRun);
    queue.promote([ref("y"), ref("z")], clock.now + 60_000);
    // Z runs and records; Y is still queued, then an edit queues Z again.
    queue.remove(ref("z"));
    queue.add(ref("z"), Priority.direct);
    // One request: C4 orders them, the edited Z first.
    expect(names(queue.ordered())).toEqual(["z", "y", "b"]);
    // Both leave; Y's run is in flight, Z settled and is queued again: the promotion holds.
    queue.remove(ref("y"));
    queue.remove(ref("z"));
    running.add(testFileId(ref("y")));
    queue.add(ref("z"), Priority.direct);
    expect(queue.isPromoted(ref("z"))).toBe(true);
    // Every selected key settled: a later edit's Z is ordinary work.
    queue.remove(ref("z"));
    running.clear();
    queue.add(ref("z"), Priority.neverRun);
    expect(names(queue.ordered())).toEqual(["b", "z"]);
  });

  it("orders at one clock reading: a wait that ends between two entries' ranks ranks neither (row 011-347)", () => {
    const { queue, clock } = queueAt();
    const until = clock.now + 5_000;
    queue.add(ref("b"), Priority.neverRun);
    queue.add(ref("y"), Priority.neverRun);
    queue.add(ref("z"), Priority.neverRun);
    queue.promote([ref("y"), ref("z")], until);
    // Z ran; an edit queues it again. It joins Y's batch at the next settle, so until then it
    // is ranked only while the wait is open.
    queue.remove(ref("z"));
    queue.add(ref("z"), Priority.direct);
    // Each reading of the clock is 1 ms later: the first is the wait's last open moment.
    clock.now = until - 1;
    let reads = 0;
    queue.setPromotionClock(
      () => clock.now + reads++,
      () => false,
    );
    // One reading, the first: Z is still the batch's, and the edited Z leads it.
    expect(names(queue.ordered())).toEqual(["z", "y", "b"]);
    expect(reads).toBe(1);
    reads = 0;
    expect(names(queue.orderedBatches())).toEqual(["y", "z"]);
    expect(reads).toBe(1);
    // The decision's own reading, passed in: the same order at it, none of the clock's.
    reads = 0;
    expect(names(queue.ordered(undefined, false, until - 1))).toEqual(["z", "y", "b"]);
    expect(names(queue.orderedBatches(undefined, until - 1))).toEqual(["y", "z"]);
    expect(reads).toBe(0);
    // At the wait's deadline Z is no batch's; Y, a member, still is.
    expect(names(queue.ordered(undefined, false, until))).toEqual(["y", "z", "b"]);
    expect(names(queue.orderedBatches(undefined, until))).toEqual(["y"]);
  });

  it("counts toward the four first-group tiers after which the backlog gets its turn", () => {
    const { queue, clock } = queueAt();
    for (let i = 0; i < 3; i++) queue.add(ref(`backlog${i}`), Priority.failing);
    const tiers: string[][] = [];
    for (let t = 0; t < 5; t++) {
      // A named wait keeps one promoted file queued at every tier boundary.
      const named = ref(`named${t}`);
      queue.add(named, Priority.neverRun);
      queue.promote([named], clock.now + 60_000);
      const tier = queue.ordered().slice(0, 1);
      expect(queue.hasFirstGroup()).toBe(true);
      expect(queue.hasRecent()).toBe(false);
      for (const r of tier) queue.remove(r);
      queue.tierSelected(tier.some((r) => r.path.includes("backlog")));
      tiers.push(names(tier));
    }
    expect(RECENT_TIERS_PER_BACKLOG_TIER).toBe(4);
    expect(tiers).toEqual([["named0"], ["named1"], ["named2"], ["named3"], ["backlog0"]]);
  });

  it("leads the slow class's order too", () => {
    const { queue, clock } = queueAt();
    queue.setSlow(() => true);
    queue.add(ref("slow-b"), Priority.neverRun);
    queue.add(ref("slow-z"), Priority.neverRun);
    queue.promote([ref("slow-z")], clock.now + 60_000);
    expect(names(queue.orderedSlow())).toEqual(["slow-z", "slow-b"]);
    expect(queue.hasFirstGroup()).toBe(false);
  });

  it("is dropped with the queue", () => {
    const { queue, clock } = queueAt();
    queue.add(ref("z"), Priority.neverRun);
    queue.promote([ref("z")], clock.now + 60_000);
    queue.clear();
    queue.add(ref("b"), Priority.neverRun);
    queue.add(ref("z"), Priority.neverRun);
    expect(names(queue.ordered())).toEqual(["b", "z"]);
  });
});

describe("a batch's place and what a focused tier counts (rows 011-268 and 011-283, from batch-select and focused-group-turn)", () => {
  it("a re-wait of files already in a batch forms no batch, and the first keeps its place", () => {
    const { queue, clock } = queueAt();
    const first = ["a0", "a1"].map(ref);
    const second = ["c0", "c1"].map(ref);
    for (const r of [...first, ...second]) queue.add(r, Priority.transitive);
    queue.promote(first, clock.now + 1_000);
    queue.promote(second, clock.now + 60_000);
    clock.now += 2_000;
    // Past the first wait's deadline, its re-wait names the same files and one of the second's.
    queue.promote([...first, ref("c0")], clock.now + 60_000);
    expect(names(queue.orderedBatches())).toEqual(["a0", "a1", "c0", "c1"]);
    expect(queue.rankAt(ref("a0"), clock.now)?.rank).toBeLessThan(
      queue.rankAt(ref("c0"), clock.now)?.rank ?? 0,
    );
  });

  it("a focused tier of a wait's group makes the backlog's turn due, before or after the edits' tiers", () => {
    const { queue, clock } = queueAt();
    queue.add(ref("b"), Priority.transitive);
    queue.add(ref("e"), Priority.edited, false, true);
    queue.promote([ref("f")], clock.now + 60_000);
    queue.focusedSelected([ref("f")]);
    expect(queue.batchTurn()).toBe(true);
    // A turn that takes the backlog ends it.
    queue.tierSelected(true);
    expect(queue.batchTurn()).toBe(false);
  });

  it("a focused tier of a wait's group counts not toward the four first-group tiers", () => {
    const { queue, clock } = queueAt();
    queue.add(ref("b"), Priority.transitive);
    queue.add(ref("e"), Priority.edited, false, true);
    queue.promote([ref("f")], clock.now + 60_000);
    for (let t = 0; t < RECENT_TIERS_PER_BACKLOG_TIER; t++) queue.focusedSelected([ref("f")]);
    expect(queue.backlogTurn()).toBe(false);
  });

  it("a focused entry of no wait's group counts as a first-group tier (row 011-145)", () => {
    const { queue } = queueAt();
    queue.add(ref("b"), Priority.transitive);
    queue.add(ref("e"), Priority.edited, false, true);
    for (let t = 0; t < RECENT_TIERS_PER_BACKLOG_TIER; t++) queue.focusedSelected([ref("f")]);
    expect(queue.batchTurn()).toBe(false);
    expect(queue.backlogTurn()).toBe(true);
  });
});
