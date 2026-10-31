/*
 * Throwaway probe for research row 011-273 (`research/named-wait-rule.md`).
 * Not part of the product suite. It reads today's ownership of a named
 * wait through public scheduler modules: no daemon, no runner, a private
 * temporary store. Each case prints one JSON line that the findings quote.
 */
import { describe, expect, it } from "vitest";
import { testFileId } from "../../../../../../src/core/keys/index.js";
import {
  FOCUSED_FILES,
  type FocusedRun,
  readFocused,
  writeFocused,
} from "../../../../../../src/core/scheduler/focused-row.js";
import {
  type PublishedPromotion,
  promotionsMetaKey,
  publishedBatches,
} from "../../../../../../src/core/scheduler/promotions.js";
import { Priority, RunQueue } from "../../../../../../src/core/scheduler/queue.js";
import type { CheckKey, EpochMs, TestFileRef } from "../../../../../../src/core/types/index.js";
import { fakeCommonDir, open } from "../../../../../../test/store/helpers.js";

const ref = (name: string): TestFileRef => ({ project: "", path: `test/${name}.test.ts` });
const names = (refs: readonly TestFileRef[]) =>
  refs.map((r) => r.path.replace(/^test\/|\.test\.ts$/g, ""));
const log = (probe: string, value: unknown) =>
  console.log(JSON.stringify({ probe, ...(value as object) }));

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

describe("011-273 probe: what a named wait owns today", () => {
  it("P1 gh-127: a wait that comes before its file is queued holds nothing when the file is queued later", () => {
    const { queue, clock } = queueAt();
    queue.add(ref("backlog"), Priority.neverRun);
    // The load gate keeps the retried file unqueued; the wait sends its one promotion now.
    queue.promote([ref("retried")], clock.now + 60_000);
    clock.now += 5_000;
    // The gate opens inside the wait's deadline: the retry queues one forced run.
    queue.add(ref("retried"), Priority.failing, true);
    const late = {
      promoted: queue.isPromoted(ref("retried")),
      firstGroup: queue.isFirstGroup(ref("retried")),
    };
    // Control: the same file already queued when the promotion comes.
    const control = queueAt();
    control.queue.add(ref("backlog"), Priority.neverRun);
    control.queue.add(ref("retried"), Priority.failing, true);
    control.queue.promote([ref("retried")], control.clock.now + 60_000);
    const early = {
      promoted: control.queue.isPromoted(ref("retried")),
      firstGroup: control.queue.isFirstGroup(ref("retried")),
    };
    log("P1", { late, early });
    expect(late).toEqual({ promoted: false, firstGroup: false });
    expect(early).toEqual({ promoted: true, firstGroup: true });
  });

  it("P2 gh-127: an explicit retry with no wait queues in the second group, behind an edit's work", () => {
    const { queue } = queueAt();
    queue.add(ref("retried"), Priority.failing, true);
    queue.add(ref("edited"), Priority.direct, false, true);
    queue.add(ref("other"), Priority.neverRun);
    const order = names(queue.ordered());
    log("P2", { order, retryFirstGroup: queue.isFirstGroup(ref("retried")) });
    expect(order[0]).toBe("edited");
    expect(queue.isFirstGroup(ref("retried"))).toBe(false);
  });

  it("P3 gh-116: the predecessor's batch row is still in the store, and a successor reads none of it", () => {
    const store = open(fakeCommonDir());
    const { queue, clock, told } = queueAt();
    queue.add(ref("a"), Priority.neverRun);
    queue.add(ref("b"), Priority.neverRun);
    queue.promote([ref("b")], clock.now + 60_000);
    const live = told.at(-1) ?? [];
    // The predecessor wrote its row at 1,000; it never deletes it on a step-down.
    store.meta.set(
      promotionsMetaKey("w"),
      JSON.stringify({ at: clock.now, promotions: live }),
    );
    const successorStart = (clock.now + 1) as EpochMs;
    const read = publishedBatches(store, "w", successorStart, (clock.now + 2) as EpochMs);
    const raw = JSON.parse(store.meta.get(promotionsMetaKey("w")) ?? "{}") as {
      promotions: PublishedPromotion[];
    };
    const successor = new RunQueue();
    successor.add(ref("a"), Priority.neverRun);
    successor.add(ref("b"), Priority.neverRun);
    const out = {
      rowBatchFiles: raw.promotions.map((p) => p.batch?.files ?? []),
      successorReads: read.size,
      successorOrder: names(successor.ordered()),
    };
    log("P3", out);
    expect(out.rowBatchFiles).toEqual([[testFileId(ref("b"))]]);
    expect(out.successorReads).toBe(0);
    expect(out.successorOrder).toEqual(["a", "b"]);
  });

  it("P4 gh-123: the focused row keeps 20 files, so an open wait over 24 loses 4 outcomes", () => {
    const store = open(fakeCommonDir());
    const run = (i: number): FocusedRun => ({
      testFile: ref(`rows-${String(i).padStart(2, "0")}`),
      key: `k${i}` as CheckKey,
      revision: 1 as FocusedRun["revision"],
      texts: [" U2 "],
      runId: `r${i}`,
      logDir: `/tmp/r${i}`,
      startedAt: (1_000 + i) as EpochMs,
      endedAt: (2_000 + i) as EpochMs,
      end: "completed",
      reason: null,
      collected: 7,
      matched: 1,
      checks: [],
      more: 0,
      outcomes: { pass: 1, fail: 0, skip: 0 },
    });
    // One wait's 24 files; their focused runs end one by one.
    for (let i = 1; i <= 24; i++) writeFocused(store, "w", [run(i)]);
    const kept = readFocused(store, "w").map((r) => names([r.testFile])[0]);
    const lost = Array.from({ length: 24 }, (_, i) => `rows-${String(i + 1).padStart(2, "0")}`)
      .filter((n) => !kept.includes(n));
    log("P4", { cap: FOCUSED_FILES, kept: kept.length, lost });
    expect(kept).toHaveLength(20);
    expect(lost).toEqual(["rows-01", "rows-02", "rows-03", "rows-04"]);
  });

  it("P5 011-266 S3 and gh-127: a batch nobody waits for keeps leading the lane after its deadline", () => {
    const { queue, clock } = queueAt();
    queue.add(ref("named"), Priority.neverRun);
    queue.add(ref("retried"), Priority.failing, true);
    queue.promote([ref("named")], clock.now + 1_000);
    clock.now += 600_000;
    const order = names(queue.ordered());
    log("P5", { minutesPastDeadline: 10, order, namedFirstGroup: queue.isFirstGroup(ref("named")) });
    expect(order).toEqual(["named", "retried"]);
  });
});
