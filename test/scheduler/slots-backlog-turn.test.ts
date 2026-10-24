import { describe, expect, it } from "vitest";
import { RECENT_TIERS_PER_BACKLOG_TIER } from "../../src/core/scheduler/queue.js";
import { RUN_MISSING } from "../helpers/baseline.js";
import { slotHarness, testPath } from "./slots-fixture.js";

/*
 * Review wave-4 slice 2, B2 (spec 011 C4 step 4: after four tiers in a row of
 * the first group only while the second waited, the next tier is the
 * second group's): in a lane of slots, an edit's tier leaves the backlog's
 * files to the slots, but the backlog's turn still takes one. With
 * `runner.tierSize` 1 the lane's one slot is held, so only edits' tiers can
 * run beside it; six edited files keep the first group full for six tiers.
 */
const EDITED = Array.from({ length: 6 }, (_, i) => testPath(`e${i}`));
const BACKLOG = Array.from({ length: 3 }, (_, i) => testPath(`b${i}`));
const HELD = testPath("a0");

describe("scheduler: the backlog's turn in a lane of slots (review wave-4 slice 2, B2)", () => {
  it("runs a backlog file after four edits' tiers while the edits keep coming", {
    timeout: 120_000,
  }, async () => {
    expect(RECENT_TIERS_PER_BACKLOG_TIER).toBe(4);
    const files = ["a0", "e0", "e1", "e2", "e3", "e4", "e5", "b0", "b1", "b2"].map((name) => ({
      name,
      sleepMs: 0,
    }));
    const { h, runs } = await slotHarness({
      files,
      hostSlots: 2,
      tierSize: 1,
      policy: RUN_MISSING,
    });
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    // Every run the scheduler starts, in order, as it starts.
    const started: string[][] = [];
    h.gate.before = async (picked) => {
      started.push(picked.map((f) => f.path));
      if (picked.some((f) => f.path === HELD)) await held;
    };
    try {
      await h.scheduler.start();
      await expect.poll(() => started.length, { timeout: 30_000 }).toBe(1);
      // The baseline's first slot holds the lane; its other files are queued as the backlog.
      expect(started).toEqual([[HELD]]);

      for (const path of EDITED) {
        h.write(path, 'import { test } from "node:test";\ntest("edited", () => {});\n');
      }
      await h.batch(...EDITED);
      // Seven tiers beside the held slot: before the repair, six edits' and then none.
      await expect.poll(() => started.length, { timeout: 30_000 }).toBeGreaterThanOrEqual(8);
      const after = started.slice(1, 8);
      expect(after.every((tier) => tier.length === 1)).toBe(true);
      const backlogAt = after.findIndex((tier) => tier.some((path) => BACKLOG.includes(path)));
      expect(backlogAt).toBe(RECENT_TIERS_PER_BACKLOG_TIER);
    } finally {
      release();
    }
    await h.scheduler.idle();
    const ran = runs.flatMap((run) => run.files.map((f) => f.path));
    for (const path of [...EDITED, ...BACKLOG]) expect(ran).toContain(path);
  });
});
