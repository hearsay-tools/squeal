import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { poolPermitFile } from "../../src/core/capacity/index.js";
import { takePermit } from "../../src/core/slow/index.js";
import { fileName } from "./claims-fixture.js";
import { spread, wallOf, wallSide } from "./wall-fixture.js";

/*
 * Task 001-366 (spec 011 C4 step 5 as amended 2026-10-19,
 * `research/backlog-wall-budget.md`): a backlog tier takes one file per
 * worker it will run with, then more while `sum / W + (1 − 1/W) × longest`
 * of last-known durations stays within 120 s. Summed as if serial, cezar's
 * 80 to 145 s files ran one to three per tier and its tail never finished.
 */
const BUDGET_MS = 120_000;
const heavy = spread(16, 60_000, 150_000);

describe("scheduler: a backlog tier is budgeted by its wall time (C4 step 5, task 001-366)", () => {
  it("runs 16 heavy files in one tier when the pool offers 23 workers", async () => {
    const side = wallSide({ durations: heavy, hostSlots: 23 });
    const tiers = await side.backlog();
    expect(tiers.map((t) => t.files.length)).toEqual([16]);
    expect(tiers[0]?.workers).toBeGreaterThanOrEqual(16);
  });

  it("fills one round of 4, then keeps each tier's wall estimate within 120 s", async () => {
    const side = wallSide({ durations: heavy, hostSlots: 4 });
    const tiers = await side.backlog();
    const byPath = new Map(heavy.map((d, i) => [fileName(i), d]));
    expect(tiers[0]?.files).toHaveLength(4);
    for (const tier of tiers) {
      const durations = tier.files.map((f) => byPath.get(f.path) ?? 0);
      if (durations.length > 4) expect(wallOf(durations, 4)).toBeLessThanOrEqual(BUDGET_MS);
    }
    expect(tiers.flatMap((t) => t.files)).toHaveLength(16);
  });

  it("trims a tier granted less than offered to the prefix that fits at the grant", async () => {
    const side = wallSide({ durations: heavy, hostSlots: 23 });
    await side.scheduler.start();
    await side.scheduler.idle();
    // A racing daemon took 18 permits and has not marked: the offer is 23, the grant 5.
    const owner = { pid: process.pid, worktreeId: "racing-daemon" };
    for (let i = 0; i < 18; i++) {
      const db = takePermit(join(side.dir, poolPermitFile(i)), owner);
      if (db === null) throw new Error(`permit ${i} taken`);
      onTestFinished(() => db.close());
    }
    side.runner.hold();
    const before = side.runner.runs.length;
    await side.scheduler.requestFullSuite({ force: true });
    await expect.poll(() => side.runner.active).toBe(1);
    const [first] = side.runner.runs.slice(before);
    const ordered = [...heavy].sort((a, b) => a - b);
    // At 5 workers: the round of 5, then while the estimate stays within 120 s.
    let keep = 5;
    while (keep < ordered.length && wallOf(ordered.slice(0, keep + 1), 5) <= BUDGET_MS) keep++;
    expect(first?.files).toHaveLength(keep);
    expect(first?.workers).toBe(5);
    side.runner.release();
    await side.scheduler.idle();
    const later = side.runner.runs.slice(before + 1).flatMap((t) => t.files);
    expect(new Set([...(first?.files ?? []), ...later].map((f) => f.path)).size).toBe(16);
  });

  it("holds at most a node:test lane's width in permits, and the other lane runs beside it with the rest", async () => {
    // Files 0-8 are a node:test project's, run `runner.tierSize` (4) wide; 9-24 another lane's.
    const inNodeLane = (path: string) => Number(path.match(/f(\d+)/)?.[1]) < 9;
    // 9 files of 5 to 20 s fit 4 wide: 28 s + 15 s estimated.
    const durations = [...spread(9, 5_000, 20_000), ...heavy];
    const side = wallSide({
      durations,
      hostSlots: 23,
      lane: (f) => (inNodeLane(f.path) ? "node-test" : "vitest"),
      tierWidth: (f, grant) => (inNodeLane(f.path) ? 4 : grant),
    });
    await side.scheduler.start();
    await side.scheduler.idle();
    side.runner.hold();
    const before = side.runner.runs.length;
    await side.scheduler.requestFullSuite({ force: true });
    await expect.poll(() => side.runner.active).toBe(2);
    const tiers = side.runner.runs.slice(before);
    const nt = tiers.find((t) => t.files.every((f) => inNodeLane(f.path)));
    const vt = tiers.find((t) => t.files.every((f) => !inNodeLane(f.path)));
    expect(nt?.files).toHaveLength(9);
    expect(nt?.workers).toBe(4);
    expect(vt?.files).toHaveLength(16);
    expect(vt?.workers).toBe(16);
    side.runner.release();
    await side.scheduler.idle();
  });

  it("sums the estimates of parts that run one after another (review wave-3 B1)", async () => {
    // Eight 1 s files, 4 wide, B = 2 s: as one part a tier takes 5 (1.25 + 0.75 = 2 s); as
    // eight node:test projects of one lane, which a composite runs in turn, 5 would take 5 s.
    const durations = Array(8).fill(1_000);
    const one = wallSide({ durations, hostSlots: 4, timeoutMs: 4_000, tierWidth: () => 4 });
    expect((await one.backlog()).map((t) => t.files.length)).toEqual([5, 3]);
    const parts = wallSide({
      durations,
      hostSlots: 4,
      timeoutMs: 4_000,
      tierWidth: () => 4,
      tierPart: (f) => f.path,
    });
    expect((await parts.backlog()).map((t) => t.files.length)).toEqual([2, 2, 2, 2]);
  });

  it("caps the wall estimate at half of runner.timeoutMs when that is less than 120 s", async () => {
    // 16 files of 1 s, 4 wide, a 4 s timeout: the budget is 2 s, so a round of 4 and one more.
    const side = wallSide({ durations: Array(16).fill(1_000), hostSlots: 4, timeoutMs: 4_000 });
    const tiers = await side.backlog();
    expect(tiers.map((t) => t.files.length)).toEqual([5, 5, 5, 1]);
    for (const tier of tiers) {
      const durations = tier.files.map(() => 1_000);
      if (durations.length > 4) expect(wallOf(durations, 4)).toBeLessThanOrEqual(2_000);
    }
  });

  it("still takes 200 light files a tier, a file of no known duration counting 0", async () => {
    const light = spread(600, 100, 3_000);
    const side = wallSide({ durations: light, hostSlots: 23 });
    const tiers = await side.backlog();
    expect(tiers.map((t) => t.files.length)).toEqual([200, 200, 200]);
    // The baseline knew no duration: one tier up to `runner.backlogTierSize`.
    expect(side.runner.runs.slice(0, 3).map((t) => t.files.length)).toEqual([200, 200, 200]);
  });
});
