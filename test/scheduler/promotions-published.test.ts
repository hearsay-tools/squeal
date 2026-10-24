import { describe, expect, it } from "vitest";
import { testFileId } from "../../src/core/keys/index.js";
import {
  type PublishedPromotion,
  promotedIds,
  promotionsMetaKey,
  publishPromotions,
} from "../../src/core/scheduler/promotions.js";
import { Priority, RunQueue } from "../../src/core/scheduler/queue.js";
import type { EpochMs, TestFileRef } from "../../src/core/types/index.js";
import { RUN_MISSING } from "../helpers/baseline.js";
import { fakeCommonDir, open } from "../store/helpers.js";
import { claimRepo, fileName, side } from "./claims-fixture.js";

/*
 * Task 011-13 (011 C15): the daemon publishes its live promotions in `meta`,
 * rewritten on each change and dropped when none is left, for the named
 * wait to say `queued, promoted, ...`.
 */

const ref = (name: string): TestFileRef => ({ project: "", path: `test/${name}.test.ts` });
const id = (name: string) => testFileId(ref(name));

/** A queue on a clock the test moves, recording each publication. */
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

describe("a queue tells each change of its live promotions (task 011-13)", () => {
  it("on a promotion, on its settling, and on a clear; not when nothing changed", () => {
    const { queue, clock, told } = queueAt();
    queue.add(ref("z"), Priority.neverRun);
    queue.promote([ref("z"), ref("y")], clock.now + 60_000);
    expect(told).toEqual([[{ files: [id("z"), id("y")], until: 61_000 }]]);

    // Nothing of it is queued or running: no promotion, nothing told.
    queue.promote([ref("x")], clock.now + 60_000);
    queue.add(ref("w"), Priority.neverRun);
    expect(told).toHaveLength(1);

    // Z left the queue (it ran): the next queueing settles the promotion.
    queue.remove(ref("z"));
    queue.add(ref("v"), Priority.neverRun);
    expect(told.at(-1)).toEqual([]);

    queue.promote([ref("v")], clock.now + 1_000);
    queue.clear();
    expect(told.at(-1)).toEqual([]);
    expect(told).toHaveLength(4);
  });

  it("past its deadline a promotion is settled and told gone", () => {
    const { queue, clock, told } = queueAt();
    queue.add(ref("z"), Priority.neverRun);
    queue.promote([ref("z")], clock.now + 100);
    clock.now += 100;
    queue.add(ref("b"), Priority.neverRun);
    expect(told.at(-1)).toEqual([]);
  });
});

describe("the published promotions in `meta` (task 011-13)", () => {
  const STARTED = 10_000 as EpochMs;
  const live = [{ files: [id("z")], until: 20_000 as EpochMs }];

  it("hold their files before the deadline, and none at or after it", () => {
    const store = open(fakeCommonDir());
    publishPromotions(store, "w", live, 11_000 as EpochMs);
    expect([...promotedIds(store, "w", STARTED, 19_999 as EpochMs)]).toEqual([id("z")]);
    expect(promotedIds(store, "w", STARTED, 20_000 as EpochMs).size).toBe(0);
    expect(promotedIds(store, "other", STARTED, 11_000 as EpochMs).size).toBe(0);
  });

  it("a row written before the live daemon started is a predecessor's: nothing is promoted", () => {
    const store = open(fakeCommonDir());
    publishPromotions(store, "w", live, (STARTED - 1) as EpochMs);
    expect(promotedIds(store, "w", STARTED, 11_000 as EpochMs).size).toBe(0);
  });

  it("none left drops the row; no row, or one that does not parse, promotes nothing", () => {
    const store = open(fakeCommonDir());
    publishPromotions(store, "w", live, 11_000 as EpochMs);
    publishPromotions(store, "w", [], 12_000 as EpochMs);
    expect(store.meta.get(promotionsMetaKey("w"))).toBeNull();
    expect(promotedIds(store, "w", STARTED, 11_000 as EpochMs).size).toBe(0);
    const key = promotionsMetaKey("w");
    store.meta.set(key, "{");
    expect(promotedIds(store, "w", STARTED, 11_000 as EpochMs).size).toBe(0);
  });

  it("a scheduler's promotion is published while its file is queued", async () => {
    const [A, , Z] = [fileName(0), fileName(1), fileName(2)];
    const { main } = claimRepo(3);
    const a = side(main, { count: 3, tierSize: 1, policy: RUN_MISSING });
    a.runner.hold();
    await a.scheduler.start();
    await expect.poll(() => a.phase(A)).toBe("running");
    expect(promotedIds(a.store, a.worktreeId, 0 as EpochMs, Date.now() as EpochMs).size).toBe(0);

    await a.scheduler.promote([{ project: "", path: Z }], 60_000);
    const held = promotedIds(a.store, a.worktreeId, 0 as EpochMs, Date.now() as EpochMs);
    expect([...held]).toEqual([testFileId({ project: "", path: Z })]);
    a.runner.release();
    await a.scheduler.idle();
  });
});
