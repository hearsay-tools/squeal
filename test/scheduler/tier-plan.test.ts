import { describe, expect, it } from "vitest";
import {
  type Candidate,
  type Idle,
  isIdle,
  planTiers,
} from "../../src/core/scheduler/tier-plan.js";
import type { Tier } from "../../src/core/scheduler/tiers.js";
import { NOW, type Row, type Table, tableOf } from "./tier-plan-table.js";

/*
 * Row 011-346 (`research/tier-plan.md`): the tier plan over a table, no
 * store, no scheduler, no timer. Each former self-call of `selectTier` is a
 * row here, with the order of its asks.
 */

const rows = (prefix: string, count: number, row: Omit<Row, "path"> = {}): Row[] =>
  Array.from({ length: count }, (_, i) => ({ path: `${prefix}${i + 1}`, ...row }));

function plan(table: Table) {
  const t = tableOf(table);
  return { ...t, plan: planTiers(t.view, t.asks) };
}

function candidate(step: Candidate | Idle | null): Candidate {
  if (step === null || isIdle(step)) throw new Error(`no candidate: ${JSON.stringify(step)}`);
  return step;
}

function idle(step: Candidate | Idle | null): Idle {
  if (step === null || !isIdle(step)) throw new Error("a candidate, not idle");
  return step;
}

const paths = (step: Candidate | Idle | null) => candidate(step).files.map((f) => f.file.ref.path);

/** A started tier as the act step reports it. */
const started = (c: Candidate, slot = false) =>
  ({
    files: c.files,
    kind: c.kind,
    lane: c.lane,
    ...(slot ? { slot: true } : {}),
  }) as unknown as Tier;

describe("the tier plan's candidates (row 011-346)", () => {
  it("an edit's tier: the edit's work, no grant, and lookups only up to the tier's size", () => {
    const { plan: p, log } = plan({ rows: rows("e", 6, { recent: true }) });
    const first = candidate(p.first);
    expect([first.reason, first.kind, first.width]).toEqual(["edit", "edit", null]);
    expect(paths(first)).toEqual(["e1", "e2", "e3", "e4"]);
    expect(log).toEqual(["begin", "lookup e1", "lookup e2", "lookup e3", "lookup e4"]);
  });

  it("the backlog: a grant ask at the offer, after the size and the offer are asked", () => {
    const { plan: p, log } = plan({ rows: rows("b", 3), offer: 8 });
    const first = candidate(p.first);
    expect([first.reason, first.kind, first.counts, first.tookBacklog]).toEqual([
      "backlog",
      "backlog",
      "tier",
      true,
    ]);
    expect(first.width).toMatchObject({ want: 3, least: 1, offer: 8, refusalWaits: true });
    expect(log).toEqual(["begin", "offer 200", "lookup b1", "lookup b2", "lookup b3"]);
  });

  it("a stored result settles a file: it is not a candidate's and the next file takes its place", () => {
    const { plan: p } = plan({
      rows: [
        { path: "e1", recent: true, stored: true },
        ...rows("e", 2, { recent: true }).slice(1),
      ],
    });
    expect(paths(p.first)).toEqual(["e2"]);
  });

  it("an unkeyed file leaves the queue unlooked-up", () => {
    const {
      plan: p,
      log,
      queued,
    } = plan({
      rows: [
        { path: "e1", recent: true, keyed: false },
        { path: "e2", recent: true },
      ],
    });
    expect(paths(p.first)).toEqual(["e2"]);
    expect(log.slice(0, 3)).toEqual(["begin", "drop e1", "lookup e2"]);
    expect(queued.has("e1")).toBe(false);
  });

  it("tierCap: a capped file leads a tier of its cap, and waits when it would join a fuller one", () => {
    const capped = plan({
      rows: [
        { path: "e1", recent: true, tierCap: 1 },
        { path: "e2", recent: true },
      ],
    });
    expect(paths(capped.plan.first)).toEqual(["e1"]);
    const later = plan({
      rows: [
        { path: "e1", recent: true },
        { path: "e2", recent: true, tierCap: 1 },
      ],
    });
    expect(paths(later.plan.first)).toEqual(["e1"]);
  });

  it("joinSpan and cut marks: a far slower file, or one cut past its estimate, waits for the next tier", () => {
    const slow = plan({
      rows: [
        { path: "e1", recent: true, ms: 1_000 },
        { path: "e2", recent: true, ms: 100_000 },
        { path: "e3", recent: true, ms: 2_000 },
      ],
    });
    expect(paths(slow.plan.first)).toEqual(["e1", "e3"]);
    const cut = plan({
      rows: [
        { path: "e1", recent: true },
        { path: "e2", recent: true, cut: true },
      ],
    });
    expect(paths(cut.plan.first)).toEqual(["e1"]);
  });

  it("a lane that waits for quiet takes no backlog tier, but an edit's tier takes the backlog's files", () => {
    const held = plan({ rows: rows("b", 2), quiet: ["fast"], quietWakeMs: 400 });
    expect(idle(held.plan.first)).toEqual({ idle: "quiet", at: NOW, wakeAt: NOW + 400 });
    const edit = plan({ rows: [{ path: "e1", recent: true }, ...rows("b", 1)], quiet: ["fast"] });
    expect(paths(edit.plan.first)).toEqual(["e1", "b1"]);
  });

  it("an edit's tier leaves a slot lane's backlog to its slots", () => {
    const { plan: p } = plan({
      rows: [
        { path: "e1", recent: true },
        { path: "s1", slot: 1 },
      ],
    });
    expect(paths(p.first)).toEqual(["e1"]);
  });
});

describe("the six former self-calls of selectTier (row 011-346)", () => {
  it("284: after a batch's tier, the backlog's turn of the second group's files goes first", () => {
    const { plan: p } = plan({
      rows: [{ path: "e1", recent: true }, { path: "b1" }],
      batchTurn: true,
    });
    const first = candidate(p.first);
    expect([first.reason, first.kind, paths(first)]).toEqual(["turn-after-batch", "turn", ["b1"]]);
    expect(first.width).not.toBeNull();
  });

  it("418: a due turn that started no second-group file leaves the lane to a waiting focused entry", () => {
    const { plan: p, log } = plan({
      rows: [
        { path: "f1", focus: true },
        { path: "e1", recent: true },
      ],
      turnDue: true,
    });
    const first = candidate(p.first);
    expect([first.reason, first.kind, paths(first)]).toEqual(["focused", "focused", ["f1"]]);
    expect(first.focus?.map((pick) => pick.entry.ref.path)).toEqual(["f1"]);
    // The turn's pass picked e1, then ended (a commit) before the focused stage.
    expect(log).toEqual(["begin", "lookup e1", "end"]);
  });

  it("423: a batch's tier the pool refused goes at once as an edit's tier of its first 4 files", () => {
    const { plan: p, log } = plan({ rows: rows("w", 6, { batch: 1, ms: 1_000 }), offer: 8 });
    const first = candidate(p.first);
    expect([first.reason, first.kind, first.promoted, paths(first).length]).toEqual([
      "batch",
      "backlog",
      true,
      6,
    ]);
    expect(first.width?.refusalWaits).toBe(false);
    const again = candidate(p.afterRefusal("pool"));
    expect([again.reason, again.width, again.promoted, again.counts]).toEqual([
      "batch-as-edit",
      null,
      true,
      "batch",
    ]);
    expect(paths(again)).toEqual(["w1", "w2", "w3", "w4"]);
    expect(log.filter((l) => l === "end")).toHaveLength(1);
  });

  it("461: review 0.1.413 B1, six 500 s files at a grant of 3: narrower than an edit's, so as an edit's", () => {
    const { plan: p } = plan({ rows: rows("s", 6, { batch: 1, ms: 500_000 }), offer: 3 });
    const first = candidate(p.first);
    expect(paths(first)).toEqual(["s1", "s2", "s3"]);
    expect(first.width?.atGrant(3)).toMatchObject({ narrower: true });
    const again = candidate(p.afterRefusal("narrower"));
    expect([again.reason, paths(again)]).toEqual(["batch-as-edit", ["s1", "s2", "s3", "s4"]]);
  });

  it("a batch granted what it asked is not narrower; a lower grant trims its tail and is", () => {
    const { plan: p } = plan({ rows: rows("w", 6, { batch: 1, ms: 500_000 }), offer: 8 });
    const ask = candidate(p.first).width;
    expect(ask?.atGrant(6).narrower).toBe(false);
    expect(ask?.atGrant(6).files).toHaveLength(6);
    // At 2 workers the 600 s budget holds 2 files of 500 s; an edit's tier would run 4.
    const low = ask?.atGrant(2);
    expect(low?.files.map((f) => f.file.ref.path)).toEqual(["w1", "w2"]);
    expect(low?.narrower).toBe(true);
  });

  it("440: the turn the pool refused lets the edit's tier go first; the turn stays due", () => {
    const { plan: p } = plan({
      rows: [{ path: "e1", recent: true }, { path: "b1" }],
      turnDue: true,
    });
    const turn = candidate(p.first);
    expect([turn.reason, turn.kind, paths(turn)[0]]).toEqual(["turn", "turn", "b1"]);
    const edit = candidate(p.afterRefusal("pool"));
    expect([edit.reason, edit.kind, edit.width, paths(edit)[0]]).toEqual([
      "edit",
      "edit",
      null,
      "e1",
    ]);
  });

  it("491: a batch whose every file waits on a claim: the rest of the queue starts", () => {
    const { plan: p, log } = plan({
      rows: [{ path: "w1", batch: 1, claimed: true }, { path: "b1" }],
    });
    const next = candidate(p.first);
    expect([next.reason, paths(next)]).toEqual(["after-claims", ["b1"]]);
    expect(log.slice(0, 5)).toEqual(["begin", "offer 200", "lookup w1", "held w1", "end"]);
  });

  it("496: the edit's work settled by lookups leaves the backlog's slots to start now", () => {
    const { plan: p, log } = plan({
      rows: [
        { path: "e1", recent: true, stored: true },
        { path: "s1", slot: 1 },
      ],
    });
    const slot = candidate(p.first);
    expect([slot.reason, slot.kind, paths(slot)]).toEqual(["backlog", "backlog", ["s1"]]);
    expect(slot.width).toMatchObject({ want: 1, least: 1 });
    expect(log).toEqual(["begin", "lookup e1", "end", "begin", "offer 200", "lookup s1"]);
  });

  it("496: a pick settled in the start plans the same pass again", () => {
    const { plan: p, queued } = plan({ rows: rows("e", 2, { recent: true }) });
    const first = candidate(p.first);
    queued.delete("e1");
    expect(paths(p.afterUnstarted(first.files))).toEqual(["e2"]);
  });

  it("496: a start that left every pick queued (claims) ends idle", () => {
    const { plan: p } = plan({ rows: rows("e", 2, { recent: true }) });
    const first = candidate(p.first);
    expect(idle(p.afterUnstarted(first.files)).idle).toBe("lane-busy");
  });
});

describe("the plan's stages and idle answers (row 011-346)", () => {
  it("beside: with every lane busy, an edit's tier beside a running batch's", () => {
    const { plan: p } = plan({
      rows: [{ path: "e1", recent: true }],
      busy: ["fast"],
      beside: ["e1"],
    });
    const beside = candidate(p.first);
    expect([beside.reason, beside.beside, beside.counts, paths(beside)]).toEqual([
      "beside",
      true,
      "none",
      ["e1"],
    ]);
  });

  it("slot: after a backlog slot starts, the next slot is planned in the same turn", () => {
    const { plan: p, queued } = plan({ rows: rows("s", 2, { slot: 1 }), slots: true });
    const first = candidate(p.first);
    queued.delete("s1");
    const next = candidate(p.afterStart(started(first, true)));
    expect([next.reason, paths(next)]).toEqual(["slot", ["s2"]]);
    queued.delete("s2");
    expect(idle(p.afterStart(started(next, true))).idle).toBe("nothing-queued");
  });

  it("a start that is no slot ends the plan; asking again throws", () => {
    const { plan: p } = plan({ rows: rows("e", 1, { recent: true }), slots: true });
    expect(p.afterStart(started(candidate(p.first)))).toBeNull();
    expect(() => p.afterRefusal()).toThrow(/no candidate out/);
  });

  it.each([
    ["claims", { rows: [{ path: "b1", claimed: true }] }, NOW + 1_000],
    ["quiet", { rows: rows("b", 1), quiet: ["fast"], quietWakeMs: 250 }, NOW + 250],
    ["nothing-queued", { rows: [] }, null],
    ["lane-busy", { rows: rows("e", 1, { recent: true }), busy: ["fast"] }, null],
  ] as const)("idle: %s", (reason, table: Table, wakeAt) => {
    expect(idle(plan(table).plan.first)).toEqual({ idle: reason, at: NOW, wakeAt });
  });
});
