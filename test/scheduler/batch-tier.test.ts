import { describe, expect, it } from "vitest";
import { B, batchesOf, E, Gate, heldBatch, P, P_LONGEST, paths, Q, S, X } from "./batch-fixture.js";
import { pause, ref, SETTLE_MS, START_WITHIN_MS } from "./tier-yields-fixture.js";

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
    // Here no tier mixes them, the backlog's turn follows each batch tier while the backlog lasts
    // (review 0.1.378 B1), and the batch's tiers keep its order.
    const tiers = side.runner.runs.slice(side.runner.runs.indexOf(batch));
    const ofP = (run: (typeof tiers)[number]) => paths(run).every((path) => P.includes(path));
    expect(tiers.every((run) => ofP(run) || !paths(run).some((path) => P.includes(path)))).toBe(
      true,
    );
    expect(tiers.filter(ofP).flatMap(paths)).toEqual(P_LONGEST);
    // Two tiers of one kind in a row only once the other kind has run out.
    tiers.forEach((run, i) => {
      const next = tiers[i + 1];
      if (next === undefined || ofP(run) !== ofP(next)) return;
      expect(tiers.slice(i + 1).every((later) => ofP(later) === ofP(run))).toBe(true);
    });
    // Between the batch's tiers, each backlog tier is a turn of at most `runner.tierSize` files.
    const between = tiers.slice(0, tiers.findLastIndex(ofP)).filter((run) => !ofP(run));
    expect(between.length).toBeGreaterThan(0);
    expect(between.every((run) => run.files.length <= 4)).toBe(true);
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

  it("the backlog's turn after a batch's tier: an edit does not cancel it, a new wait does not cut it (review 0.1.378 B1)", async () => {
    const { side, gate, batch } = await heldBatch();
    // Hold the backlog's run once the batch's tier ends.
    const turnGate = new Gate();
    const holdBatch = side.runner.holdOf;
    side.runner.holdOf = (run) =>
      paths(run).some((path) => B.includes(path)) ? turnGate.wait() : holdBatch?.(run);
    gate.stop();
    const after = side.runner.runs.indexOf(batch) + 1;
    const turnRun = () =>
      side.runner.runs
        .slice(after)
        .find((run) => run.endedAt === null && paths(run).some((path) => B.includes(path)));
    await expect.poll(() => turnRun() !== undefined, { timeout: START_WITHIN_MS }).toBe(true);
    const turn = turnRun();
    if (turn === undefined) throw new Error("no turn after the batch");
    // C4 step 4's turn: `runner.tierSize` files of a comparable time, with a grant.
    expect(turn.files.length).toBeLessThanOrEqual(4);
    expect(turn.workers).toBeDefined();

    // Before the repair the tier after the batch was the backlog's, which E's edit cancelled.
    await side.edit("watch", "src/e.ts");
    await side.scheduler.promote(
      Q.map((path) => ref(path)),
      600_000,
    );
    await pause(SETTLE_MS);
    expect(turn.cancelled).toBe(false);
    expect(turn.endedAt).toBeNull();

    turnGate.stop();
    await side.scheduler.idle();
    expect(turn.completed).toHaveLength(turn.files.length);
    expect([...P, ...B, E, ...Q].every((path) => side.current(path))).toBe(true);
  });
});
