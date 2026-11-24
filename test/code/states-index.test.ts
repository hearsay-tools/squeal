import type { DatabaseSync } from "node:sqlite";
import { DatabaseSync as Sqlite } from "node:sqlite";
import { describe, expect, it } from "vitest";
import {
  codeStorePath,
  isCodeStoreOpenFailure,
  openCodeStore,
} from "../../src/core/code/store/open.js";
import {
  STATES_EDITED,
  STATES_FAILING,
  STATES_NON_PASS,
} from "../../src/core/code/store/states.js";
import type { CodeStore } from "../../src/core/code/store/types.js";
import { Connection, type Params, type Row } from "../../src/core/store/connection.js";
import type { CodeKnownState, CodeMeasure, CodeOutcome } from "../../src/core/types/code.js";
import { check, commonDir, ON, open } from "./helpers.js";

/*
 * Row 015-127: a tool boundary reads a worktree's failing states
 * (`states.list` with the `fail` outcome) and its edited states
 * (`states.edits`). With `? IS NULL OR` predicates SQLite's planner scanned
 * every state of the worktree by primary key, 260,000 on 005-110's copy.
 * The reads now name only the predicates their filter has, and the partial
 * indexes `states_failing` and `states_edited` when the file has them; a
 * store a reader opened first has none, and every answer is the same.
 */

const WT = "wt-1";
const OTHER = "wt-2";

function state(
  worktreeId: string,
  name: string,
  measure: CodeMeasure,
  outcome: CodeOutcome,
  path = "src/a.ts",
): CodeKnownState {
  return {
    worktreeId,
    check: check(name, path),
    measure,
    outcome,
    value: outcome === "fail" ? 30 : 3,
    threshold: 20,
    countedAt: 1,
    blob: `blob-${path}`,
    changedAt: 1,
  };
}

/** States of two worktrees, three measures and every outcome; some edited. */
function seeded(): string {
  const dir = commonDir();
  const store = open(dir);
  store.states.upsertMany([
    state(WT, "pay", "complexity", "fail"),
    state(WT, "settle", "complexity", "pass"),
    state(WT, "zap", "complexity", "fail", "src/b.ts"),
    state(WT, "pay", "crap", "fail"),
    state(WT, "settle", "uncovered", "pending"),
    state(WT, "zap", "crap", "unknown", "src/b.ts"),
    state(OTHER, "pay", "complexity", "fail"),
  ]);
  store.states.markEdited(WT, [
    { check: check("pay"), measure: "complexity", revision: 4, at: 40 },
    { check: check("settle"), measure: "complexity", revision: 5, at: 50 },
    { check: check("pay"), measure: "crap", revision: 6, at: 60 },
  ]);
  store.states.markEdited(OTHER, [
    { check: check("pay"), measure: "complexity", revision: 7, at: 70 },
  ]);
  store.close();
  return dir;
}

/** A connection that keeps each read's statement, for its plan. */
class Recording extends Connection {
  readonly reads: [string, Params][] = [];
  constructor(readonly raw: DatabaseSync) {
    super(raw);
  }
  override all(sql: string, ...params: Params): Row[] {
    this.reads.push([sql, params]);
    return super.all(sql, ...params);
  }
}

function recorded(dir: string, create = true): { store: CodeStore; conn: Recording } {
  let conn: Recording | undefined;
  const store = openCodeStore(dir, ON, {
    create,
    connection: (db) => {
      conn = new Recording(db);
      return conn;
    },
  });
  if (isCodeStoreOpenFailure(store) || conn === undefined) throw new Error("open failed");
  return { store, conn };
}

/** The plan of the last read `conn` made. */
function lastPlan(conn: Recording): string {
  const [sql, params] = conn.reads.at(-1) ?? ["", []];
  return conn.raw
    .prepare(`EXPLAIN QUERY PLAN ${sql}`)
    .all(...params)
    .map((row) => String(row.detail))
    .join(" | ");
}

/** Every answer the boundary's reads and the others give, by name. */
function answers(store: CodeStore) {
  const names = (states: readonly CodeKnownState[]) =>
    states.map((s) => `${s.check.path}:${s.check.qualifiedName}:${s.measure}:${s.outcome}`);
  return {
    failing: names(store.states.list(WT, { measure: "complexity", outcome: "fail" })),
    failingAll: names(store.states.list(WT, { outcome: "fail" })),
    pending: names(store.states.list(WT, { outcome: "pending" })),
    crap: names(store.states.list(WT, { measure: "crap" })),
    all: names(store.states.list(WT)),
    pathFailing: names(store.states.list(WT, { paths: ["src/b.ts"], outcome: "fail" })),
    edits: store.states.edits(WT, "complexity").map((e) => [e.check.qualifiedName, e.revision]),
    crapEdits: store.states.edits(WT, "crap").map((e) => [e.check.qualifiedName, e.at]),
    pathEdits: store.states.edits(WT, "complexity", ["src/a.ts"]).map((e) => e.revision),
    complexityCounts: store.states.countNonPass(WT, "complexity"),
    crapCounts: store.states.countNonPass(WT, "crap"),
    uncoveredCounts: store.states.countNonPass(WT, "uncovered"),
    otherCounts: store.states.countNonPass(OTHER, "complexity"),
  };
}

const EXPECTED = {
  failing: ["src/a.ts:pay:complexity:fail", "src/b.ts:zap:complexity:fail"],
  failingAll: [
    "src/a.ts:pay:complexity:fail",
    "src/a.ts:pay:crap:fail",
    "src/b.ts:zap:complexity:fail",
  ],
  pending: ["src/a.ts:settle:uncovered:pending"],
  crap: ["src/a.ts:pay:crap:fail", "src/b.ts:zap:crap:unknown"],
  all: [
    "src/a.ts:pay:complexity:fail",
    "src/a.ts:pay:crap:fail",
    "src/a.ts:settle:complexity:pass",
    "src/a.ts:settle:uncovered:pending",
    "src/b.ts:zap:complexity:fail",
    "src/b.ts:zap:crap:unknown",
  ],
  pathFailing: ["src/b.ts:zap:complexity:fail"],
  edits: [
    ["pay", 4],
    ["settle", 5],
  ],
  crapEdits: [["pay", 60]],
  pathEdits: [4, 5],
  complexityCounts: { fail: 2, pending: 0, unknown: 0 },
  crapCounts: { fail: 1, pending: 0, unknown: 1 },
  uncoveredCounts: { fail: 0, pending: 1, unknown: 0 },
  otherCounts: { fail: 1, pending: 0, unknown: 0 },
};
const INDEXES = [STATES_EDITED, STATES_FAILING, STATES_NON_PASS];

function hasIndexes(dir: string): string[] {
  const db = new Sqlite(codeStorePath(dir), { readOnly: true });
  try {
    return db
      .prepare("SELECT name FROM sqlite_master WHERE name IN (?, ?, ?) ORDER BY name")
      .all(...INDEXES)
      .map((row) => String(row.name));
  } finally {
    db.close();
  }
}

describe("the boundary's code reads (row 015-127)", () => {
  it("name their partial index, each with only the predicates the filter has", () => {
    const { store, conn } = recorded(seeded());
    try {
      store.states.list(WT, { measure: "complexity", outcome: "fail" });
      expect(lastPlan(conn)).toMatch(
        /SEARCH s USING INDEX states_failing \(worktree_id=\? AND measure=\?\)/,
      );
      expect(conn.reads.at(-1)?.[0]).not.toMatch(/IS NULL/);
      store.states.list(WT, { outcome: "fail" });
      expect(lastPlan(conn)).toMatch(/SEARCH s USING INDEX states_failing \(worktree_id=\?\)/);
      store.states.edits(WT, "crap");
      expect(lastPlan(conn)).toMatch(
        /SEARCH s USING INDEX states_edited \(worktree_id=\? AND measure=\?\)/,
      );
      // A few paths' states stay a lookup by key, path by path (row 015-45).
      store.states.list(WT, { paths: ["src/a.ts"], outcome: "fail" });
      expect(lastPlan(conn)).toMatch(
        /SEARCH s USING PRIMARY KEY \(worktree_id=\? AND check_id=\?\)/,
      );
      // Status counts the states that do not pass, never reading the passing ones (025 D6.1).
      store.states.countNonPass(WT, "complexity");
      expect(lastPlan(conn)).toMatch(
        /SEARCH states USING (COVERING )?INDEX states_non_pass \(worktree_id=\? AND measure=\?\)/,
      );
    } finally {
      store.close();
    }
  });

  it("give the same answers with the indexes as without them", () => {
    const dir = seeded();
    expect(hasIndexes(dir)).toEqual(INDEXES);
    const indexed = open(dir);
    expect(answers(indexed)).toEqual(EXPECTED);
    indexed.close();
    const db = new Sqlite(codeStorePath(dir));
    for (const name of INDEXES) db.exec(`DROP INDEX ${name}`);
    db.close();
    // An older store, as a daemon that predates the indexes leaves it, read by a hook.
    const { store: reader, conn } = recorded(dir, false);
    expect(answers(reader)).toEqual(EXPECTED);
    reader.states.list(WT, { measure: "complexity", outcome: "fail" });
    expect(lastPlan(conn)).not.toMatch(/states_failing/);
    reader.states.countNonPass(WT, "complexity");
    expect(lastPlan(conn)).not.toMatch(/states_non_pass/);
    reader.close();
    expect(hasIndexes(dir)).toEqual([]);
    // The next creating open makes them again, and the answers stay.
    const daemon = open(dir);
    expect(hasIndexes(dir)).toEqual(INDEXES);
    expect(answers(daemon)).toEqual(EXPECTED);
  });
});
