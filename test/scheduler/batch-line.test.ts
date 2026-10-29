import { describe, expect, it } from "vitest";
import { classLines, fileEntry } from "../../src/cli/named-file-lines.js";
import { wallEstimate } from "../../src/core/scheduler/backlog.js";
import {
  promotionsMetaKey,
  publishedBatches,
  publishPromotions,
} from "../../src/core/scheduler/promotions.js";
import { timeText } from "../../src/core/text.js";
import type { EpochMs, WorktreeId } from "../../src/core/types/index.js";
import { liveDaemon } from "../delivery/fakes.js";
import { freshStore } from "../state/helpers.js";
import { heldBatch, P, P_MS, Q, standingOf } from "./batch-fixture.js";
import { pause, ref, SETTLE_MS } from "./tier-yields-fixture.js";

/*
 * Row 011-268 (spec 011 C15 as amended 2026-10-29, done-when test 7): a
 * named wait's line names its file's batch, the batch's position and its
 * tier's estimated end, and `--json` carries the same place in one new
 * field. The `promotions` meta row keeps each entry's `files` and `until`,
 * the fields a reader before this row reads, and a row such a daemon wrote
 * still reads as its promotions until their deadlines.
 */
describe("the wait's line names the batch (spec 011 C15, row 011-268)", {
  timeout: 120_000,
}, () => {
  it("7. names the batch, its position and its estimated end; --json adds the place", async () => {
    const { side, gate, batch } = await heldBatch();
    await side.scheduler.promote(
      Q.map((path) => ref(path)),
      600_000,
    );
    await pause(SETTLE_MS);

    const durations = P.map((_, i) => P_MS(i));
    const sum = durations.reduce((total, ms) => total + ms, 0);
    const end = side.now() + wallEstimate(sum, Math.max(...durations), batch.workers ?? 0);
    const running = standingOf(side, P[0] ?? "");
    const place = { position: 1, of: 2, files: 55, estimatedEnd: end };
    expect(running.standing).toMatchObject({ kind: "running", batch: place });
    const [, runningLine] = classLines([running], "squeal");
    expect(runningLine).toContain(
      `in batch 1 of 2 (55 files), its tier estimated to end at ${timeText(end)}`,
    );
    expect(fileEntry(running, "squeal").batch).toEqual(place);

    const queued = standingOf(side, Q[0] ?? "");
    const later = { position: 2, of: 2, files: 4, estimatedEnd: null };
    expect(queued.standing).toMatchObject({ kind: "queued", promoted: true, batch: later });
    const [, queuedLine] = classLines([queued], "squeal");
    expect(queuedLine).toMatch(
      /queued, promoted, in batch 2 of 2 \(4 files\), after batch 1, behind the \S+ tier of 55 test files running since/,
    );
    expect(fileEntry(queued, "squeal").batch).toEqual(later);

    // A reader before row 011-268 reads `files` and `until` of each entry; both stay.
    const raw = side.store.meta.get(promotionsMetaKey(side.worktreeId as WorktreeId));
    const { promotions } = JSON.parse(raw ?? "{}") as { promotions: Record<string, unknown>[] };
    expect(promotions).toHaveLength(2);
    for (const entry of promotions) {
      expect(Array.isArray(entry.files)).toBe(true);
      expect(typeof entry.until).toBe("number");
    }
    gate.stop();
    await side.scheduler.idle();
  });

  it("a row of a daemon before row 011-268 reads as promotions until their deadlines, with no place", () => {
    const store = freshStore();
    const worktreeId = "wt-011-268-older" as WorktreeId;
    liveDaemon(store, worktreeId);
    const at = 1_000_000 as EpochMs;
    publishPromotions(store, worktreeId, [{ files: ["\0test/a.test.ts"], until: at + 10 }], at);

    expect([...publishedBatches(store, worktreeId, at, at)]).toEqual([["\0test/a.test.ts", null]]);
    expect(publishedBatches(store, worktreeId, at, (at + 10) as EpochMs).size).toBe(0);
    store.close();
  });
});
