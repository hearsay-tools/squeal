import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { shareBudget } from "../../src/core/scheduler/backlog.js";
import { TierCapacity } from "../../src/core/scheduler/capacity.js";
import type { CapacityOptions } from "../../src/core/scheduler/options.js";
import {
  type Candidate,
  type Idle,
  isIdle,
  planTiers,
} from "../../src/core/scheduler/tier-plan.js";
import type { WorktreeId } from "../../src/core/types/common.js";
import { type Row, type Table, tableOf } from "./tier-plan-table.js";

/*
 * Row 011-418 (spec 011 C4 step 5 as amended, `research/run-width-design.md`
 * arm (c+d)): a backlog tier's wall budget, 120 s here, is scaled by the
 * offer's share of its full width, at most 1: the background ceiling, or
 * the slots when fewer (`TierCapacity.fullWidth`). The table's runner
 * runs a tier as wide as its grant; its `timeoutMs` is 600 s, so the budget
 * is 120 s.
 */

const rows = (count: number, ms: number | null): Row[] =>
  Array.from({ length: count }, (_, i) => ({ path: `b${i + 1}`, ms }));

function first(table: Table): Candidate {
  const t = tableOf(table);
  const step: Candidate | Idle = planTiers(t.view, t.asks).first;
  if (isIdle(step)) throw new Error(`no candidate: ${JSON.stringify(step)}`);
  return step;
}

const selectedMs = (files: Candidate["files"]) =>
  files.reduce((sum, f) => sum + (f.file.durationMs ?? 0), 0);

describe("a backlog tier's budget scales with the offer's share of its full width (row 011-418)", () => {
  it("an offer of 1 of 9 selects about 13 s of 2 s files, not 120 s", () => {
    const tier = first({ rows: rows(100, 2_000), offer: 1, fullWidth: 9 });
    expect(tier.width?.offer).toBe(1);
    // 120 s × 1/9 = 13.3 s at one worker: six files of 2 s.
    expect(tier.files).toHaveLength(6);
    expect(selectedMs(tier.files)).toBeLessThanOrEqual(13_400);
    // Without a full width (no pool) the budget is whole: 60 files of 2 s at one worker.
    expect(first({ rows: rows(100, 2_000), offer: 1 }).files).toHaveLength(60);
  });

  it("an offer of the whole ceiling, or more, selects as without the scale", () => {
    // At 9 workers 20 s files fill 120 s with 46 of them: 46 × 20 / 9 + 8/9 × 20 s ≤ 120 s.
    const whole = first({ rows: rows(100, 20_000), offer: 9 });
    expect(whole.files).toHaveLength(46);
    const atCeiling = first({ rows: rows(100, 20_000), offer: 9, fullWidth: 9 });
    expect(atCeiling.files.map((f) => f.file.ref.path)).toEqual(
      whole.files.map((f) => f.file.ref.path),
    );
    // A checkpoint's offer can pass the ceiling (it is gated by the slots): the share is at most 1.
    const above = first({ rows: rows(100, 20_000), offer: 11, fullWidth: 9 });
    const unscaled = first({ rows: rows(100, 20_000), offer: 11 });
    expect(above.files).toHaveLength(unscaled.files.length);
  });

  it("a fractional ceiling (0.75 of 9 CPUs is 6.75) gives a 7-worker offer the whole budget", () => {
    const fractional = first({ rows: rows(100, 20_000), offer: 7, fullWidth: 6.75 });
    expect(fractional.files).toHaveLength(
      first({ rows: rows(100, 20_000), offer: 7 }).files.length,
    );
  });

  it("a grant below the offer trims by the grant's share", () => {
    const tier = first({ rows: rows(250, 2_000), offer: 9, fullWidth: 9 });
    expect(tier.files).toHaveLength(200); // the backlog tier's size, well inside 120 s at 9 workers
    const at = (grant: number) => tier.width?.atGrant(grant).files ?? [];
    // 1 of 9: 13.3 s at one worker, six files; before row 011-418 the whole 120 s, 60 files.
    expect(at(1)).toHaveLength(6);
    // 3 of 9: 40 s at three workers: n × 2 s / 3 + 2/3 × 2 s ≤ 40 s holds 58 files.
    expect(at(3)).toHaveLength(58);
    expect(at(9)).toHaveLength(200);
  });

  it("a grant below the offer trims by its share also at a runner's capped width (review 0.1.576 B1)", () => {
    // A runner capped at 2 workers, offer 3 of 9: the pick's 40 s at 2 workers holds 39 files of
    // 2 s. The grant of 2 equals the width the tier asks, yet is below the offer: its budget,
    // 120 s × 2/9 = 26.7 s at 2 workers, holds n × 2 s / 2 + 1 s ≤ 26.7 s, 25 files.
    const t = tableOf({ rows: rows(250, 2_000), offer: 3, fullWidth: 9 });
    t.view.tierWidth = (_, grant) => Math.min(2, Math.max(1, grant));
    const step = planTiers(t.view, t.asks).first;
    if (isIdle(step)) throw new Error("no candidate");
    expect([step.width?.want, step.files.length]).toEqual([2, 39]);
    expect(step.width?.atGrant(2).files).toHaveLength(25);
    expect(step.width?.atGrant(3).files).toHaveLength(39);
    expect(step.width?.atGrant(1).files).toHaveLength(6);
  });

  it("a tier still takes one file per worker: a file longer than the budget, or of no known time", () => {
    const long = first({ rows: rows(10, 60_000), offer: 1, fullWidth: 9 });
    expect(long.files.map((f) => f.file.ref.path)).toEqual(["b1"]);
    // An offer of 0 leaves a budget of 0: the first round still picks one file.
    const none = first({ rows: rows(10, 60_000), offer: 0, fullWidth: 9 });
    expect(none.files).toHaveLength(1);
    // A file with no known duration counts 0 against the budget (C4 step 5), so it is taken.
    const unknown = first({ rows: rows(10, null), offer: 1, fullWidth: 9 });
    expect(unknown.files.length).toBeGreaterThanOrEqual(1);
    const trimmed = first({ rows: rows(10, 60_000), offer: 9, fullWidth: 9 }).width?.atGrant(1);
    expect(trimmed?.files).toHaveLength(1);
  });

  it("a batch's tier keeps its whole budget whatever the offer", () => {
    const batch = (ceiling?: number) =>
      first({
        rows: Array.from({ length: 6 }, (_, i) => ({ path: `w${i + 1}`, batch: 1, ms: 100_000 })),
        offer: 2,
        ...(ceiling === undefined ? {} : { fullWidth: ceiling }),
      });
    expect(batch(9).files).toHaveLength(batch().files.length);
    expect(batch(9).width?.atGrant(1).files).toHaveLength(
      batch().width?.atGrant(1).files.length ?? -1,
    );
  });
});

describe("shareBudget (row 011-418)", () => {
  it("is the budget times the workers' share of the full width, at most 1, whole without one", () => {
    expect(shareBudget(120_000, 1, 9)).toBeCloseTo(13_333, 0);
    expect(shareBudget(120_000, 9, 9)).toBe(120_000);
    expect(shareBudget(120_000, 18, 9)).toBe(120_000);
    expect(shareBudget(120_000, 0, 9)).toBe(0);
    expect(shareBudget(120_000, 1, null)).toBe(120_000);
    // A full width under 1 (a ceiling under 1 CPU) counts 1, so one worker is the whole share.
    expect(shareBudget(120_000, 1, 0)).toBe(120_000);
  });
});

describe("TierCapacity.fullWidth (row 011-418)", () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  it("is the workers the background ceiling admits, or the host's or the project's slots when fewer", () => {
    const root = mkdtempSync(join(tmpdir(), "squeal-full-width-"));
    roots.push(root);
    const dir = join(root, "squeal-uid");
    const opened: TierCapacity[] = [];
    const fullWidth = (options: Omit<CapacityOptions, "dir">) => {
      const capacity = new TierCapacity({ dir, ...options }, "me" as WorktreeId, () => {});
      opened.push(capacity);
      return capacity.fullWidth();
    };
    try {
      // 12 CPUs, 11 slots: the ceiling, 0.75 of 12 = 9, binds.
      expect(fullWidth({ cpus: 12, hostSlots: 11 })).toBe(9);
      expect(fullWidth({ cpus: 12, hostSlots: 11, backgroundShare: 0.5 })).toBe(6);
      // Row 011-424: 10 CPUs, ceiling 7.5, admit 8 workers, the backlog shares' total.
      expect(fullWidth({ cpus: 10, hostSlots: 9 })).toBe(8);
      // Slots below the ceiling bind: a tier offered all of them is not cut.
      expect(fullWidth({ cpus: 64, hostSlots: 4 })).toBe(4);
      expect(fullWidth({ cpus: 12, hostSlots: 11, project: { id: "/p", slots: 2 } })).toBe(2);
    } finally {
      for (const capacity of opened) capacity.close();
    }
  });
});
