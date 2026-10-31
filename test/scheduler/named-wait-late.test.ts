import { describe, expect, it } from "vitest";
import { testFileId } from "../../src/core/keys/index.js";
import type { PublishedPromotion } from "../../src/core/scheduler/promotions.js";
import { Priority, RunQueue } from "../../src/core/scheduler/queue.js";
import type { TestFileRef } from "../../src/core/types/index.js";

/*
 * Row 011-283 (011-273 option B, `research/named-wait-rule.md` rule 3 and
 * F1; gh-127 in part): a named wait is kept until its deadline whether or
 * not a file of it is queued when it comes, so a file queued later, before
 * the deadline, joins its group and leads its lane. After the deadline it
 * does not. Research probe P1 showed `promoted: false` on 0.1.379.
 */

const ref = (name: string): TestFileRef => ({ project: "", path: `test/${name}.test.ts` });
const names = (refs: readonly TestFileRef[]) =>
  refs.map((r) => r.path.replace(/^test\/|\.test\.ts$/g, ""));

function queueAt() {
  const clock = { now: 1_000 };
  const told: (readonly PublishedPromotion[])[] = [];
  const queue = new RunQueue();
  queue.setPromotionClock(
    () => clock.now,
    () => false,
    (live) => told.push(live),
  );
  return { queue, clock, told };
}

describe("a wait that comes before its file is queued (row 011-283, test 1)", () => {
  it("the file queued before the deadline joins the wait's group and leads its lane", () => {
    const { queue, clock, told } = queueAt();
    queue.add(ref("backlog"), Priority.neverRun);
    queue.add(ref("edited"), Priority.edited, false, true);
    // The load gate keeps the retried file unqueued; the wait sends its one promotion now.
    queue.promote([ref("retried")], clock.now + 60_000);
    clock.now += 5_000;
    // The gate opens inside the wait's deadline: the retry queues one forced run.
    queue.add(ref("retried"), Priority.failing, true);
    expect(queue.isPromoted(ref("retried"))).toBe(true);
    expect(names(queue.ordered())).toEqual(["retried", "edited", "backlog"]);
    expect(names(queue.orderedBatches())).toEqual(["retried"]);
    // The next settle makes it a member of the group, which the row then names.
    queue.add(ref("other"), Priority.neverRun);
    expect(told.at(-1)?.map((p) => p.batch?.files)).toEqual([[testFileId(ref("retried"))]]);
  });

  it("after the deadline the file queued is not promoted, and the group is gone", () => {
    const { queue, clock, told } = queueAt();
    queue.add(ref("backlog"), Priority.neverRun);
    queue.promote([ref("retried")], clock.now + 60_000);
    clock.now += 60_000;
    queue.add(ref("retried"), Priority.failing, true);
    expect(queue.isPromoted(ref("retried"))).toBe(false);
    expect(queue.isFirstGroup(ref("retried"))).toBe(false);
    expect(told.at(-1)).toEqual([]);
  });

  it("two waits for one unqueued file: it joins the earlier one's group", () => {
    const { queue, clock } = queueAt();
    queue.add(ref("a"), Priority.neverRun);
    queue.promote([ref("late")], clock.now + 60_000);
    queue.promote([ref("a")], clock.now + 60_000);
    queue.promote([ref("late")], clock.now + 60_000);
    queue.add(ref("late"), Priority.neverRun);
    expect(names(queue.orderedBatches())).toEqual(["late", "a"]);
  });
});
