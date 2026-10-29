import { describe, expect, it } from "vitest";
import { B, batchesOf, E, heldBatch, P, P_LONGEST, paths, Q, S, X } from "./batch-fixture.js";
import { pause, ref, SETTLE_MS } from "./tier-yields-fixture.js";

/*
 * Row 011-268 (spec 011 C4 step 5 and C15 as amended 2026-10-29,
 * `research/named-wait-batches.md` Recommendation 1, 3 and 4, done-when
 * tests 1, 2 and 5's second half): a named wait's queued files form one
 * batch, which runs as one tier at the whole grant, longest first, with no
 * wall budget but the run's deadline, and which lasts until each of its
 * files settles, not until the wait's deadline. The setup is
 * `batch-fixture.ts`.
 */
describe("a named wait's files run as one batch, longest first (spec 011 C15, row 011-268)", {
  timeout: 120_000,
}, () => {
  it("1. 55 promoted files, no edit's work: one tier holds all 55 at the grant, longest first", async () => {
    const { side, gate, batch, after } = await heldBatch();
    // On main: the backlog's 120 s budget at 24 workers took the shortest 24 or so of P.
    expect(paths(batch)).toEqual(P_LONGEST);
    expect(batch.workers).toBe(24);
    gate.stop();
    await side.scheduler.idle();
    const ofP = side.runner.runs
      .slice(after)
      .filter((run) => run.files.some((f) => P.includes(f.path)));
    expect(ofP).toEqual([batch]);
    expect([...P, ...B, X].every((path) => side.current(path))).toBe(true);
  });

  it("2. past the wait's deadline the batch keeps its files: a re-wait forms none, and no lapse lets the backlog in", async () => {
    // At 4 workers the batch needs several tiers, each within the run's 600 s deadline.
    const { side, gate, batch, after } = await heldBatch({ waitMs: 10_000, hostSlots: 4 });
    expect(paths(batch)).toEqual(P_LONGEST.slice(0, batch.files.length));
    expect(batch.files.length).toBeLessThan(P.length);
    side.advance(20_000);
    await side.scheduler.promote(
      P.map((path) => ref(path)),
      60_000,
    );
    await pause(SETTLE_MS);
    expect(batch.cancelled).toBe(false);
    // One batch of all 55: the re-wait added none, and nothing else started in the lane.
    const places = [...batchesOf(side)];
    expect(places.map(([path]) => path).toSorted()).toEqual(P);
    expect(places.every(([, place]) => place?.position === 1 && place.of === 1)).toBe(true);
    expect(side.runner.runs.slice(after)).toEqual([batch]);

    gate.stop();
    await side.scheduler.idle();
    // On main P's promotion ended at its deadline: backlog tiers took B and P, shortest first.
    // Here the backlog gets its one tier after the batch's, then the batch's tiers follow.
    const later = side.runner.runs.slice(side.runner.runs.indexOf(batch) + 1);
    const [turn, ...rest] = later;
    expect(turn === undefined ? [] : paths(turn).filter((path) => P.includes(path))).toEqual([]);
    expect(rest.every((run) => run.files.every((f) => P.includes(f.path)))).toBe(true);
    expect([batch, ...rest].flatMap(paths)).toEqual(P_LONGEST);
    expect([...P, ...B].every((path) => side.current(path))).toBe(true);
    expect(batchesOf(side).size).toBe(0);
  });

  it("past the wait's deadline, an edit's work still does not cancel the batch's tier", async () => {
    const { side, gate, batch } = await heldBatch({ waitMs: 10_000 });
    side.advance(20_000);
    // E is no input of the tier. On main, with P's promotion ended, E's work cancelled it.
    await side.edit("watch", "src/e.ts");
    await pause(SETTLE_MS);
    expect(batch.cancelled).toBe(false);
    expect(batch.endedAt).toBeNull();

    gate.stop();
    await side.scheduler.idle();
    expect(batch.completed.map((f) => f.path).toSorted()).toEqual(P);
    expect([...P, E].every((path) => side.current(path))).toBe(true);
  });

  it("5. a later wait of 4 files of 60 s starts when the first batch ends, not before", async () => {
    const { side, gate, batch } = await heldBatch({ waitMs: 10_000, backlog: false });
    side.advance(20_000);
    // On main, with P's promotion ended, Q ranked first and the tier yielded to it.
    await side.scheduler.promote(
      Q.map((path) => ref(path)),
      600_000,
    );
    await pause(SETTLE_MS);
    expect(batch.cancelled).toBe(false);
    expect(batchesOf(side).get(Q[0] ?? "")).toMatchObject({ position: 2, of: 2, files: 4 });

    gate.stop();
    await side.scheduler.idle();
    const later = side.runner.runs.slice(side.runner.runs.indexOf(batch) + 1);
    // S, re-keyed in no batch, gets the one tier after the batch's (Recommendation 4); then Q's.
    expect(later.map(paths)).toEqual([[S], Q]);
    expect(later[0]?.startedAt).toBeGreaterThanOrEqual(batch.endedAt ?? Infinity);
    expect([...P, ...Q].every((path) => side.current(path))).toBe(true);
  });
});
