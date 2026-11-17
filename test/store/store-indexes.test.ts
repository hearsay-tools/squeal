import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { isStoreOpenFailure, openStore } from "../../src/core/store/open.js";
import { storePaths } from "../../src/core/store/paths.js";
import { SCHEMA_VERSION, STORE_INDEXES } from "../../src/core/store/schema.js";
import type { Store } from "../../src/core/types/store.js";
import { fakeCommonDir, open } from "./helpers.js";

/*
 * Row 005-103: the main store's additive indexes (`STORE_INDEXES`). Each arrives at an open that
 * may create the store, when absent, with no `user_version` raise (011 C7: a raise makes every
 * older daemon of the repository exit), as the code store's (row 015-44). A hook's open
 * (`create: false`) makes none, and every read gives the same answer with or without them.
 */

/** `runs.inFlight`'s statement (`src/core/store/repos/runs.ts`). */
const IN_FLIGHT = `SELECT * FROM runs WHERE worktree_id = ? AND end_state IS NULL AND started_at >= ?
           ORDER BY started_at, rowid`;

const run = (id: string, worktreeId: string, startedAt: number) => ({
  id,
  worktreeId,
  revision: 1,
  testFiles: [],
  checkpointId: null,
  logDir: `/logs/${id}`,
  startedAt,
});

/** The names of `STORE_INDEXES` the store file at `commonDir` holds. */
function made(commonDir: string): string[] {
  const db = new DatabaseSync(storePaths(commonDir).database, { readOnly: true });
  try {
    const found = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = ?");
    return Object.keys(STORE_INDEXES).filter((name) => found.get(name) !== undefined);
  } finally {
    db.close();
  }
}

/** A store as the released Squeal leaves it: version 1, runs, none of `STORE_INDEXES`. */
function released(): string {
  const commonDir = fakeCommonDir();
  const store = open(commonDir);
  store.runs.start(run("a1", "wt-a", 10));
  store.runs.start(run("a2", "wt-a", 20));
  store.runs.start(run("b1", "wt-b", 15));
  store.runs.finish("a1", "completed", 30);
  store.close();
  const db = new DatabaseSync(storePaths(commonDir).database);
  for (const name of Object.keys(STORE_INDEXES)) db.exec(`DROP INDEX IF EXISTS ${name}`);
  db.close();
  return commonDir;
}

function reader(commonDir: string): Store {
  const store = openStore(commonDir, { create: false });
  if (isStoreOpenFailure(store)) throw new Error(`store open failed: ${store.reason}`);
  return store;
}

const inFlight = (store: Store) =>
  ["wt-a", "wt-b", "wt-c"].map((id) => store.runs.inFlight(id, 0).map((r) => r.id));

describe("the main store's additive indexes (row 005-103)", () => {
  it("are made at the first creating open of a released store, and user_version stays 1", () => {
    const commonDir = released();
    expect(made(commonDir)).toEqual([]);
    const store = open(commonDir);
    expect(made(commonDir)).toEqual(Object.keys(STORE_INDEXES));
    expect(store.schemaVersion).toBe(1);
    expect(SCHEMA_VERSION).toBe(1);
    expect(inFlight(store)).toEqual([["a2"], ["b1"], []]);
    store.close();
  });

  it("are not made by a hook's open, which reads the same without them", () => {
    const commonDir = released();
    const hook = reader(commonDir);
    const without = inFlight(hook);
    hook.close();
    expect(made(commonDir)).toEqual([]);
    const daemon = open(commonDir);
    expect(inFlight(daemon)).toEqual(without);
    daemon.close();
  });

  it("serve runs.inFlight with the open-runs index, not a scan of every run", () => {
    const commonDir = fakeCommonDir();
    open(commonDir).close();
    const db = new DatabaseSync(storePaths(commonDir).database, { readOnly: true });
    try {
      const plan = db
        .prepare(`EXPLAIN QUERY PLAN ${IN_FLIGHT}`)
        .all("wt-a", 0)
        .map((row) => String(row.detail));
      expect(plan.join(" | ")).toMatch(
        /SEARCH runs USING INDEX runs_open \(worktree_id=\? AND started_at>\?\)/,
      );
      expect(plan.join(" | ")).not.toMatch(/SCAN runs/);
    } finally {
      db.close();
    }
  });

  it("leave a store an older Squeal opens, reads and writes as before", () => {
    const commonDir = fakeCommonDir();
    open(commonDir).close();
    expect(made(commonDir)).toEqual(Object.keys(STORE_INDEXES));
    // The released Squeal refuses only a user_version above its own 1, and names its columns.
    const older = new DatabaseSync(storePaths(commonDir).database);
    try {
      expect(older.prepare("PRAGMA user_version").get()?.user_version).toBe(1);
      const start = older.prepare(
        `INSERT INTO runs (id, worktree_id, revision, test_files, checkpoint_id, log_dir, started_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      );
      start.run("o1", "wt-a", 1, "[]", null, "/logs/o1", 5);
      start.run("o2", "wt-a", 1, "[]", null, "/logs/o2", 6);
      older
        .prepare("UPDATE runs SET end_state = ?, ended_at = ? WHERE id = ?")
        .run("crashed", 9, "o1");
      expect(
        older
          .prepare(IN_FLIGHT)
          .all("wt-a", 0)
          .map((row) => row.id),
      ).toEqual(["o2"]);
      expect(older.prepare("PRAGMA integrity_check").get()?.integrity_check).toBe("ok");
    } finally {
      older.close();
    }
    const store = open(commonDir);
    expect(store.runs.inFlight("wt-a", 0).map((r) => r.id)).toEqual(["o2"]);
    store.close();
  });
});
