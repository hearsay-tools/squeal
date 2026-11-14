import { describe, expect, it } from "vitest";
import {
  type Candidate,
  type Idle,
  isIdle,
  planTiers,
} from "../../src/core/scheduler/tier-plan.js";
import { type Row, type Table, tableOf } from "./tier-plan-table.js";

/*
 * Row 011-349: the plan cases of `batch-select`, `promoted-tier-select`,
 * `focused-group-turn` and `batch-busy-host`, moved from `selectTier` on a
 * `Ledger` to the plan table. A batch (C15, rows 011-265, 011-268, 011-283
 * and 011-308) as one decision each: what the plan offers first, and after
 * a refusal. What a start counts toward is the act step's
 * (`tier-start-batch.test.ts`) and the queue's (`queue-promotion.test.ts`).
 */

const rows = (prefix: string, count: number, row: Omit<Row, "path"> = {}): Row[] =>
  Array.from({ length: count }, (_, i) => ({ path: `${prefix}${i + 1}`, ...row }));

function candidate(step: Candidate | Idle | null): Candidate {
  if (step === null || isIdle(step)) throw new Error(`no candidate: ${JSON.stringify(step)}`);
  return step;
}

/** The plan's first candidate as its reason, kind, promoted and paths. */
function first(table: Table) {
  const t = tableOf(table);
  const plan = planTiers(t.view, t.asks);
  const c = candidate(plan.first);
  return {
    reason: c.reason,
    kind: c.kind,
    promoted: c.promoted,
    paths: c.files.map((f) => f.file.ref.path),
    plan,
    queued: t.queued,
  };
}

describe("a batch leads its lane (rows 011-265 and 011-268, from promoted-tier-select)", () => {
  it("takes every file of the batch in one backlog tier, and none of the backlog", () => {
    const next = first({ rows: [...rows("p", 10, { batch: 1 }), ...rows("b", 5)] });
    expect(next).toMatchObject({ reason: "batch", kind: "backlog", promoted: true });
    expect(next.paths).toEqual(rows("p", 10).map((r) => r.path));
  });

  it("takes the batch's files free of claims; the claimed stay queued (C7)", () => {
    const next = first({
      rows: [...rows("p", 2, { batch: 1, claimed: true }), ...rows("q", 4, { batch: 1 })],
    });
    expect(next.paths).toEqual(["q1", "q2", "q3", "q4"]);
    expect(next.queued.has("p1") && next.queued.has("p2")).toBe(true);
  });

  it("with every file of the batch claimed, the backlog starts in an edit's tier as before (C7)", () => {
    const next = first({ rows: [...rows("p", 2, { batch: 1, claimed: true }), ...rows("b", 5)] });
    expect(next).toMatchObject({ reason: "after-claims", kind: "edit", promoted: false });
    expect(next.paths).toEqual(["b1", "b2", "b3", "b4"]);
  });

  it("the backlog's turn after four first-group tiers does not go before a batch", () => {
    const next = first({ rows: [...rows("d", 2, { batch: 1 }), ...rows("b", 5)], turnDue: true });
    expect(next).toMatchObject({ reason: "batch", kind: "backlog", paths: ["d1", "d2"] });
  });

  it("with an edit's work queued, before or after the wait, the batch still forms one tier", () => {
    const next = first({
      rows: [...rows("p", 10, { batch: 1 }), { path: "e1", recent: true }, ...rows("b", 5)],
    });
    expect(next).toMatchObject({ reason: "batch", kind: "backlog", promoted: true });
    expect(next.paths).toHaveLength(10);
  });

  it("a lane that runs its backlog in slots keeps the batch's files in an edit's tier", () => {
    const next = first({ rows: [...rows("p", 10, { batch: 1, slot: 1 }), ...rows("b", 5)] });
    expect(next).toMatchObject({ kind: "edit", promoted: false });
    expect(next.paths).toEqual(["p1", "p2", "p3", "p4"]);
  });
});

describe("batches and the backlog's turn (row 011-268, from batch-select)", () => {
  it("after a batch's tier, the backlog's turn; with none of the second group queued, the next batch", () => {
    const backlog = [...rows("w", 4, { batch: 2 }), ...rows("b", 6)];
    expect(first({ rows: backlog, batchTurn: true })).toMatchObject({
      reason: "turn-after-batch",
      kind: "turn",
      paths: ["b1", "b2", "b3", "b4"],
    });
    expect(first({ rows: backlog })).toMatchObject({
      reason: "batch",
      paths: ["w1", "w2", "w3", "w4"],
    });
    const batches = [...rows("w", 4, { batch: 2 }), ...rows("v", 4, { batch: 3 })];
    expect(first({ rows: batches, batchTurn: true })).toMatchObject({
      reason: "batch",
      kind: "backlog",
      paths: ["w1", "w2", "w3", "w4"],
    });
  });
});

describe("a focused tier and the post-batch turn (row 011-283, from focused-group-turn)", () => {
  const queue: Row[] = [
    { path: "f1", focus: true, batch: 1 },
    ...rows("b", 5),
    { path: "e1", recent: true },
  ];

  it("while the post-batch turn is due, the turn goes first; then the focused tier", () => {
    expect(first({ rows: queue, batchTurn: true })).toMatchObject({
      reason: "turn-after-batch",
      paths: ["b1", "b2", "b3", "b4"],
    });
    const focused = first({ rows: queue });
    expect(focused).toMatchObject({ reason: "focused", kind: "focused", paths: ["f1"] });
    expect(candidate(focused.plan.first).counts).toBe("none");
  });
});

describe("a batch on a busy host (row 011-308, from batch-busy-host)", () => {
  /** Six files of a batch, longest first `w1` at 6 s down to `w6` at 1 s. */
  const six = Array.from({ length: 6 }, (_, i) => ({
    path: `w${i + 1}`,
    batch: 1,
    ms: (6 - i) * 1_000,
  }));

  it("refused by the pool, the batch goes at once as an edit's tier of 4, then of the 2 left", () => {
    const whole = first({ rows: six, offer: 0 });
    expect(whole.paths).toHaveLength(6);
    expect(candidate(whole.plan.afterRefusal("pool"))).toMatchObject({
      reason: "batch-as-edit",
      width: null,
      promoted: true,
    });
    const rest = first({ rows: six.slice(4), offer: 0 });
    const again = candidate(rest.plan.afterRefusal("pool"));
    expect([again.reason, again.files.map((f) => f.file.ref.path)]).toEqual([
      "batch-as-edit",
      ["w5", "w6"],
    ]);
  });

  it("granted fewer workers than an edit's tier runs with, the batch is narrower and goes as an edit's", () => {
    const ask = candidate(first({ rows: six, offer: 3 }).plan.first).width;
    expect(ask?.atGrant(3).narrower).toBe(true);
    expect(ask?.atGrant(6)).toMatchObject({ narrower: false });
    expect(ask?.atGrant(6).files).toHaveLength(6);
  });

  it("an edit queued after the wait waits for the batch's tiers", () => {
    const next = first({ rows: [...six, { path: "e1", recent: true }], offer: 0 });
    expect(next).toMatchObject({ reason: "batch", promoted: true });
    expect(candidate(next.plan.afterRefusal("pool")).files.map((f) => f.file.ref.path)).toEqual([
      "w1",
      "w2",
      "w3",
      "w4",
    ]);
  });
});
