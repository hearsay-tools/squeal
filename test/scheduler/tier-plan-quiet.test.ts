import { describe, expect, it } from "vitest";
import {
  type Candidate,
  type Idle,
  isIdle,
  planTiers,
} from "../../src/core/scheduler/tier-plan.js";
import { NOW, type Row, type Table, tableOf } from "./tier-plan-table.js";

/*
 * Row 011-349: the plan cases of `backlog-quiet-select` (row 011-94) and
 * `catch-up-quiet-select` (row 011-153), moved from `selectTier` on a
 * `Ledger` to the plan table. A lane that waits for quiet after its
 * backlog tier's cancel takes no backlog tier; a lane whose catch-up waits
 * takes no catch-up in a backlog tier or a turn. An edit's tier takes both.
 * The wait itself, its wake and what it publishes stay in those files.
 */

const rows = (prefix: string, count: number, row: Omit<Row, "path"> = {}): Row[] =>
  Array.from({ length: count }, (_, i) => ({ path: `${prefix}${i + 1}`, ...row }));

function first(table: Table): Candidate | Idle | null {
  const t = tableOf(table);
  return planTiers(t.view, t.asks).first;
}

function picked(table: Table) {
  const c = first(table);
  if (c === null || isIdle(c)) throw new Error(`no candidate: ${JSON.stringify(c)}`);
  return { kind: c.kind, paths: c.files.map((f) => f.file.ref.path) };
}

const BACKLOG = rows("b", 6);
const CATCH_UP = rows("c", 6, { catchUp: true });

describe("a lane's wait for quiet after a cancel (row 011-94, from backlog-quiet-select)", () => {
  it("starts no backlog tier while the lane waits, and one of every file once the wait ends", () => {
    expect(first({ rows: BACKLOG, quiet: ["fast"], quietWakeMs: 400 })).toEqual({
      idle: "quiet",
      at: NOW,
      wakeAt: NOW + 400,
    });
    expect(picked({ rows: BACKLOG })).toEqual({
      kind: "backlog",
      paths: BACKLOG.map((r) => r.path),
    });
  });

  it("takes an edit's file at once, the backlog's beside it, and leaves the rest queued", () => {
    const tier = picked({ rows: [{ path: "e1", recent: true }, ...BACKLOG], quiet: ["fast"] });
    expect(tier).toEqual({ kind: "edit", paths: ["e1", "b1", "b2", "b3"] });
  });
});

describe("a lane's wait before catch-up (row 011-153, from catch-up-quiet-select)", () => {
  it("starts no tier of catch-up while it waits, with no cancel; then one", () => {
    expect(first({ rows: CATCH_UP, catchUpQuiet: ["fast"] })).toMatchObject({ idle: "quiet" });
    expect(picked({ rows: CATCH_UP })).toEqual({
      kind: "backlog",
      paths: CATCH_UP.map((r) => r.path),
    });
  });

  it("runs the rest of the backlog while catch-up waits, and leaves the catch-up queued", () => {
    const tier = picked({ rows: [...CATCH_UP, ...rows("b", 3)], catchUpQuiet: ["fast"] });
    expect(tier).toEqual({ kind: "backlog", paths: ["b1", "b2", "b3"] });
  });

  it("an edit's tier takes catch-up files beside its own; a batch of a catch-up file starts", () => {
    const edit = picked({
      rows: [{ path: "e1", recent: true }, ...CATCH_UP],
      catchUpQuiet: ["fast"],
    });
    expect(edit).toEqual({ kind: "edit", paths: ["e1", "c1", "c2", "c3"] });
    const batch = picked({
      rows: [{ path: "c1", catchUp: true, batch: 1 }, ...CATCH_UP.slice(1)],
      catchUpQuiet: ["fast"],
    });
    expect(batch).toEqual({ kind: "backlog", paths: ["c1"] });
  });

  it("holds catch-up from the second group's turn, which takes the rest of the backlog", () => {
    const tier = picked({
      rows: [...CATCH_UP, ...rows("b", 2), ...rows("e", 2, { recent: true })],
      catchUpQuiet: ["fast"],
      turnDue: true,
    });
    expect(tier.kind).toBe("turn");
    expect(tier.paths[0]).toBe("b1");
    expect(tier.paths.filter((path) => path.startsWith("c"))).toEqual([]);
  });
});
