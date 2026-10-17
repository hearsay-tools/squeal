import { describe, expect, it } from "vitest";
import { testFileId } from "../../src/core/keys/index.js";
import {
  Priority,
  RECENT_TIERS_PER_BACKLOG_TIER,
  RunQueue,
} from "../../src/core/scheduler/queue.js";
import type { TestFileRef } from "../../src/core/types/index.js";

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

  it("ends at the deadline", () => {
    const { queue, clock } = queueAt();
    queue.add(ref("b"), Priority.neverRun);
    queue.add(ref("z"), Priority.neverRun);
    queue.promote([ref("z")], clock.now + 5_000);
    clock.now += 5_000;
    expect(names(queue.ordered())).toEqual(["b", "z"]);
    expect(queue.isFirstGroup(ref("z"))).toBe(false);
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

  it("does not affect a file that is not queued or running", () => {
    const { queue, clock } = queueAt();
    queue.add(ref("b"), Priority.neverRun);
    queue.promote([ref("z")], clock.now + 60_000);
    queue.add(ref("z"), Priority.neverRun);
    expect(names(queue.ordered())).toEqual(["b", "z"]);
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
