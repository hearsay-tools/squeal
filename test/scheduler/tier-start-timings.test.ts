import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { appendNote } from "../../src/core/notes.js";
import { editTimingsMetaKey, readEditTimings } from "../../src/core/scheduler/edit-timings.js";
import { startNext } from "../../src/core/scheduler/tier-start.js";
import type { Tier } from "../../src/core/scheduler/tiers.js";
import { observeWrites } from "../../src/core/store/connection.js";
import { setBusyTimeout } from "../../src/core/store/open.js";
import { connectionOf } from "../../src/core/store/store.js";
import { declareTraits } from "../../src/core/types/runner-traits.js";
import type { Store } from "../../src/core/types/store.js";
import { candidate, closeStores, listPlan, NOW, setup } from "./tier-start-fixture.js";

/*
 * Row 005-96, reviews 0.1.530-r2 R2-B1 and 0.1.535 B1: the edit timings are
 * written once the tier's flight owns the launch, in a write of their own that
 * never waits on a busy store and never throws. A competing store writer, a
 * write that throws and a write SQLite rolls back whole (SQLITE_FULL) each
 * lose only the sample: the tier flies once.
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

/** Notes the scheduler takes, stored as the scheduler's `#note` stores them. */
function notesOf(fixture: ReturnType<typeof setup>): string[] {
  const { context } = fixture;
  const notes: string[] = [];
  Object.assign(context, {
    note: (text: string) => {
      notes.push(text);
      appendNote(context.store, context.worktreeId, { at: NOW, revision: null, text });
    },
  });
  return notes;
}

/** Starts an edit tier of `paths` with a flight that logs it; its tiers. */
function startEdit(fixture: ReturnType<typeof setup>, ...paths: string[]): Tier[] {
  const { context, ledger, files } = fixture;
  const flown: Tier[] = [];
  startNext(context, ledger, listPlan([candidate(files(...paths), { kind: "edit" })]), {
    fly: (tier) => flown.push(tier),
  });
  return flown;
}

describe("the edit timings at a tier's start (row 005-96, reviews 0.1.530-r2 R2-B1, 0.1.535 B1)", () => {
  it("a writer that takes the lock right after the start commits strands no launch", () => {
    const fixture = setup(2);
    const { context, ledger } = fixture;
    const notes = notesOf(fixture);
    revision(fixture, 1_500);
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
    let flown: Tier[] | Error;
    try {
      flown = startEdit(fixture, "a");
    } catch (error) {
      flown = error as Error;
    } finally {
      observeWrites(null);
      if (holding) other.exec("ROLLBACK");
      other.close();
    }
    expect(holding).toBe(true);
    if (flown instanceof Error) throw flown;
    // The tier flew once; its run row and running file are its flight's to settle.
    expect(flown.map((t) => t.files.map((f) => f.file.ref.path))).toEqual([["a"]]);
    const tier = flown[0] as Tier;
    expect(context.store.runs.get(tier.runId)?.endedAt).toBeNull();
    expect(ledger.queue.has({ project: "", path: "a" })).toBe(false);
    // The busy store lost the sample, with no note: contention may.
    expect(readEditTimings(context.store, context.worktreeId)).toBeNull();
    expect(notes).toEqual([]);
    // The writer gone, the next edit's tier records at its own start stamp.
    const next = revision(fixture, 700);
    const [later] = startEdit(fixture, "b");
    expect(later?.startedAt).toBe(NOW);
    expect(readEditTimings(context.store, context.worktreeId)).toMatchObject({
      firsts: [{ revision: next, delayMs: 700 }],
      tiers: [{ runId: later?.runId }],
    });
  });

  it("a write of the record that throws loses the sample, notes it once, and starts the tier", () => {
    const fixture = setup(2);
    const { context, ledger } = fixture;
    const notes = notesOf(fixture);
    revision(fixture, 1_000);
    const meta = context.store.meta;
    const set = meta.set.bind(meta);
    meta.set = (key: string, value: string) => {
      if (key === editTimingsMetaKey(context.worktreeId)) throw new Error("disk I/O error");
      set(key, value);
    };
    const flown = [...startEdit(fixture, "a"), ...startEdit(fixture, "b")];
    expect(flown).toHaveLength(2);
    for (const tier of flown) {
      expect(context.store.runs.get(tier.runId)).toMatchObject({ endedAt: null });
    }
    expect(ledger.queue.has({ project: "", path: "a" })).toBe(false);
    expect(readEditTimings(context.store, context.worktreeId)).toBeNull();
    expect(notes).toEqual(["squeal: could not record an edit tier's timings: disk I/O error"]);
  });

  it("a write that SQLite rolls back whole (SQLITE_FULL) loses the sample, not the launch", () => {
    // Review 0.1.535 B1: a database or disk that is full ends the whole transaction it is in.
    // The review's probe: a cap on the store's pages and a runner part too long to fit under it.
    const fixture = setup(2);
    const { context, ledger } = fixture;
    revision(fixture, 1_000);
    Object.assign(context.runner, {
      traits: declareTraits({
        tierWidth: () => 1,
        tierPart: () => `vitest:${"x".repeat(200_000)}`,
      }),
    });
    const db = connectionOf(context.store).db;
    const pages = Number(
      (db.prepare("PRAGMA page_count").get() as { page_count: number }).page_count,
    );
    db.exec(`PRAGMA max_page_count = ${pages + 10}`);
    const flown = startEdit(fixture, "a");
    expect(flown).toHaveLength(1);
    const tier = flown[0] as Tier;
    expect(context.store.runs.get(tier.runId)).toMatchObject({ endedAt: null });
    expect(ledger.queue.has({ project: "", path: "a" })).toBe(false);
    expect(db.isTransaction).toBe(false);
    expect(readEditTimings(context.store, context.worktreeId)).toBeNull();
  });

  it("a row that does not read is replaced by this tier's record", () => {
    const fixture = setup(2);
    const { context } = fixture;
    const number = revision(fixture, 0);
    context.store.meta.set(editTimingsMetaKey(context.worktreeId), "{not json");
    expect(startEdit(fixture, "a")).toHaveLength(1);
    expect(readEditTimings(context.store, context.worktreeId)).toMatchObject({
      tierSize: 4,
      firsts: [{ revision: number, delayMs: 0 }],
    });
  });

  it("a backlog tier records nothing", () => {
    const fixture = setup(2);
    const { context, ledger, files } = fixture;
    revision(fixture, 0);
    const flown: Tier[] = [];
    startNext(context, ledger, listPlan([candidate(files("a"))]), {
      fly: (tier) => flown.push(tier),
    });
    expect(flown.map((t) => t.kind)).toEqual(["backlog"]);
    expect(readEditTimings(context.store, context.worktreeId)).toBeNull();
  });

  it("a start with no flight records nothing: the caller owns that tier's flight", () => {
    const fixture = setup(2);
    const { context, ledger, files } = fixture;
    revision(fixture, 0);
    const result = startNext(context, ledger, listPlan([candidate(files("a"), { kind: "edit" })]));
    expect("tier" in result).toBe(true);
    expect(readEditTimings(context.store, context.worktreeId)).toBeNull();
  });

  it("records the grant's estimate: a tier of two at two workers", () => {
    const fixture = setup(2);
    const { context, ledger, files } = fixture;
    revision(fixture, 0);
    const picked = files("a", "b");
    for (const [i, p] of picked.entries()) p.file.durationMs = (i + 1) * 1_000;
    const flown: Tier[] = [];
    startNext(context, ledger, listPlan([candidate(picked, { kind: "edit" })]), {
      fly: (tier) => flown.push(tier),
    });
    // The scheduler's own estimate at the grant: wallEstimate(3000, 2000, 2) = 1500 + 1000.
    expect(readEditTimings(context.store, context.worktreeId)?.tiers).toEqual([
      { runId: flown[0]?.runId, estimateMs: 2_500 },
    ]);
  });
});
