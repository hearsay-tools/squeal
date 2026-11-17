import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { editTimingsMetaKey, readEditTimings } from "../../src/core/scheduler/edit-timings.js";
import { startNext } from "../../src/core/scheduler/tier-start.js";
import type { Tier } from "../../src/core/scheduler/tiers.js";
import { observeWrites } from "../../src/core/store/connection.js";
import { setBusyTimeout } from "../../src/core/store/open.js";
import { connectionOf } from "../../src/core/store/store.js";
import type { Store } from "../../src/core/types/store.js";
import { candidate, closeStores, listPlan, NOW, setup } from "./tier-start-fixture.js";

/*
 * Row 005-96, review 0.1.530-r2 R2-B1: the edit timings are written in the
 * transaction that starts the tier, so a competing store writer between the
 * start's commit and the flight strands no launch, and a failed write loses
 * only the sample.
 */

afterEach(() => {
  observeWrites(null);
  closeStores();
});

/** A revision recorded `ago` ms before the fixture's clock, as the ledger's. */
function revision(context: ReturnType<typeof setup>, ago: number): number {
  const { store, worktreeId } = context.context;
  const appended = store.revisions.append({
    worktreeId,
    createdAt: NOW - ago,
    head: null,
    dirty: true,
    trigger: "watch",
    changes: [{ path: "src/a.ts", oldHash: null, newHash: "h1" }],
  });
  context.ledger.revision = { number: appended.number, head: null, dirty: true };
  return appended.number;
}

/** A second connection to `store`'s database file. */
function secondConnection(store: Store): DatabaseSync {
  const rows = connectionOf(store).db.prepare("PRAGMA database_list").all() as { file: string }[];
  const file = rows[0]?.file;
  if (file === undefined || file === "") throw new Error("the store has no database file");
  const db = new DatabaseSync(file);
  db.exec("PRAGMA busy_timeout = 0");
  return db;
}

describe("the edit timings at a tier's start (row 005-96, review 0.1.530-r2 R2-B1)", () => {
  it("a writer that takes the lock right after the start commits strands no launch", () => {
    const fixture = setup(2);
    const { context, ledger, files } = fixture;
    const number = revision(fixture, 1_500);
    // The reviewer's probe: the store waits 10 ms on a busy lock; a second connection takes the
    // write lock as soon as the first transaction that starts here ends, and holds it.
    setBusyTimeout(context.store, 10);
    const other = secondConnection(context.store);
    let holding = false;
    observeWrites(() => () => {
      if (holding) return;
      other.exec("BEGIN IMMEDIATE");
      holding = true;
    });
    const flown: Tier[] = [];
    const picked = files("a");
    let result: ReturnType<typeof startNext> | Error;
    try {
      result = startNext(context, ledger, listPlan([candidate(picked, { kind: "edit" })]), {
        fly: (tier) => flown.push(tier),
      });
    } catch (error) {
      result = error as Error;
    } finally {
      observeWrites(null);
      if (holding) other.exec("ROLLBACK");
      other.close();
    }
    expect(holding).toBe(true);
    expect(result).not.toBeInstanceOf(Error);
    // The tier flew once; its run row and running file are its flight's to settle.
    expect(flown.map((t) => t.files.map((f) => f.file.ref.path))).toEqual([["a"]]);
    const tier = flown[0] as Tier;
    expect(context.store.runs.get(tier.runId)?.endedAt).toBeNull();
    expect(ledger.queue.has({ project: "", path: "a" })).toBe(false);
    // The sample committed with the start, at the tier's own start stamp.
    expect(tier.startedAt).toBe(NOW);
    expect(readEditTimings(context.store, context.worktreeId)).toMatchObject({
      firsts: [{ revision: number, delayMs: 1_500 }],
      tiers: [{ runId: tier.runId }],
    });
  });

  it("a write of the record that fails loses the sample and starts the tier", () => {
    const fixture = setup(2);
    const { context, ledger, files } = fixture;
    revision(fixture, 1_000);
    const meta = context.store.meta;
    const set = meta.set.bind(meta);
    meta.set = (key: string, value: string) => {
      if (key === editTimingsMetaKey(context.worktreeId)) throw new Error("disk I/O error");
      set(key, value);
    };
    const flown: Tier[] = [];
    startNext(context, ledger, listPlan([candidate(files("a"), { kind: "edit" })]), {
      fly: (tier) => flown.push(tier),
    });
    expect(flown).toHaveLength(1);
    const tier = flown[0] as Tier;
    expect(context.store.runs.get(tier.runId)).toMatchObject({ endedAt: null });
    expect(ledger.queue.has({ project: "", path: "a" })).toBe(false);
    expect(readEditTimings(context.store, context.worktreeId)).toBeNull();
  });

  it("a row that does not read is replaced by this tier's record", () => {
    const fixture = setup(2);
    const { context, ledger, files } = fixture;
    const number = revision(fixture, 0);
    context.store.meta.set(editTimingsMetaKey(context.worktreeId), "{not json");
    const result = startNext(context, ledger, listPlan([candidate(files("a"), { kind: "edit" })]));
    expect("tier" in result).toBe(true);
    expect(readEditTimings(context.store, context.worktreeId)).toMatchObject({
      tierSize: 4,
      firsts: [{ revision: number, delayMs: 0 }],
    });
  });

  it("a backlog tier records nothing", () => {
    const fixture = setup(2);
    const { context, ledger, files } = fixture;
    revision(fixture, 0);
    const result = startNext(context, ledger, listPlan([candidate(files("a"))]));
    expect("tier" in result && result.tier.kind).toBe("backlog");
    expect(readEditTimings(context.store, context.worktreeId)).toBeNull();
  });

  it("records the grant's estimate: a tier of two at two workers", () => {
    const fixture = setup(2);
    const { context, ledger, files } = fixture;
    revision(fixture, 0);
    const picked = files("a", "b");
    for (const [i, p] of picked.entries()) p.file.durationMs = (i + 1) * 1_000;
    const result = startNext(context, ledger, listPlan([candidate(picked, { kind: "edit" })]));
    const runId = "tier" in result ? result.tier.runId : "";
    // The scheduler's own estimate at the grant: wallEstimate(3000, 2000, 2) = 1500 + 1000.
    expect(readEditTimings(context.store, context.worktreeId)?.tiers).toEqual([
      { runId, estimateMs: 2_500 },
    ]);
  });
});
