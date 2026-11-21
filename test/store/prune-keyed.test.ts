import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { codeStorePath } from "../../src/core/code/store/open.js";
import { noCodeRemoved, pruneCodeSlices } from "../../src/core/code/store/prune.js";
import { Connection, observeWrites } from "../../src/core/store/connection.js";
import { storePaths } from "../../src/core/store/paths.js";
import { noneRemoved, pruneSlices } from "../../src/core/store/prune.js";
import { deleteByKey } from "../../src/core/store/prune-keyed.js";
import { connectionOf } from "../../src/core/store/store.js";
import type { CodeKnownState } from "../../src/core/types/code.js";
import * as code from "../code/helpers.js";
import { DAY_MS, fakeCommonDir, knownState, open, result, testCheck } from "./helpers.js";
import { raceAfterRead } from "./prune-race.js";

/*
 * Row 021-33: a prune finds the rows it deletes by a read outside the write
 * lock, then deletes them by key in one write transaction, where the rule is
 * tested again per key. A rule with nothing to delete takes no write lock,
 * and a row that stops matching between the read and the delete stays.
 */

const NOW = 100 * DAY_MS;
const OLD = NOW - 8 * DAY_MS;
const CODE_OPTIONS = { now: NOW, retentionDays: 7, worktrees: ["w1"], consumers: [] };

afterEach(() => observeWrites(null));

/** Each write transaction of this thread, with the rows its connection changed in it. */
function writes(): number[] {
  const seen: number[] = [];
  observeWrites((db) => {
    const total = () => Number(db.prepare("SELECT total_changes() AS n").get()?.n);
    const before = total();
    return () => seen.push(total() - before);
  });
  return seen;
}

/** A connection of its own to the code store at `dir`, which never waits for the write lock. */
function codeConnection(dir: string): Connection {
  const conn = new Connection(new DatabaseSync(codeStorePath(dir)));
  conn.db.exec("PRAGMA busy_timeout = 0");
  return conn;
}

/** A code store of one live worktree, with an old count it uses and a check its state names. */
function liveCodeStore() {
  const dir = code.commonDir();
  const store = code.open(dir);
  store.counts.put(code.count("used"), OLD);
  store.files.upsertMany("w1", [code.file("src/a.ts", "used")]);
  store.states.upsertMany([stateOf("w1")]);
  return { dir, store };
}

describe("deleteByKey (row 021-33)", () => {
  function table(rows: number): Connection {
    const conn = new Connection(new DatabaseSync(":memory:"));
    conn.db.exec("CREATE TABLE t (a TEXT, b INTEGER, PRIMARY KEY (a, b)) STRICT, WITHOUT ROWID");
    conn.transaction(() => {
      for (let i = 0; i < rows; i++) conn.run("INSERT INTO t VALUES (?, ?)", `k${i % 7}`, i);
    });
    return conn;
  }

  it("deletes 256 keys per write transaction and takes none for a read that found nothing", () => {
    const conn = table(512);
    const seen = writes();
    let removed = 0;
    const rule = {
      table: "t",
      key: ["a", "b"],
      search: "b >= 0",
      removed: (n: number) => (removed += n),
    };
    for (const slice of deleteByKey(conn, rule)) slice();
    expect(seen).toEqual([256, 256]);
    expect(removed).toBe(512);
  });

  it("deletes a rule's own batch per write transaction", () => {
    const conn = table(100);
    const seen = writes();
    for (const slice of deleteByKey(conn, {
      table: "t",
      key: ["a", "b"],
      search: "1",
      batch: 64,
    })) {
      slice();
    }
    expect(seen).toEqual([64, 36]);
  });

  it("keeps a key the recheck no longer matches, reads past it, and ends", () => {
    const conn = table(600);
    const seen = writes();
    const rule = { table: "t", key: ["a", "b"], search: "b >= 0", recheck: "b % 2 = 0" };
    for (const slice of deleteByKey(conn, rule)) slice();
    // Three reads of 256, 256 and 88 keys, each followed by one delete of its even keys.
    expect(seen).toHaveLength(3);
    expect(seen.every((n) => n > 0)).toBe(true);
    expect(Number(conn.get("SELECT count(*) AS n FROM t")?.n)).toBe(300);
  });
});

describe("a prune with nothing to delete (row 021-33)", () => {
  it("never takes the code store's write lock", () => {
    const { dir } = liveCodeStore();
    const holder = codeConnection(dir);
    holder.db.exec("BEGIN IMMEDIATE");
    const conn = codeConnection(dir);
    const counts = noCodeRemoved();
    let slices = 0;
    try {
      // With the lock held elsewhere and no busy wait, a slice that tried it would throw.
      for (const slice of pruneCodeSlices(conn, CODE_OPTIONS, counts)) {
        slice();
        slices++;
      }
    } finally {
      holder.db.exec("ROLLBACK");
    }
    expect(slices).toBeGreaterThan(0);
    expect(counts).toEqual(noCodeRemoved());
  });

  it("takes the main store's write lock only for its two expiry steps", () => {
    const commonDir = fakeCommonDir();
    const store = open(commonDir);
    store.results.putMany([result(testCheck("c1"), "k1", { recordedAt: NOW - DAY_MS })]);
    store.knownStates.upsertMany([knownState("w1", testCheck("c2"))]);
    const seen = writes();
    const counts = noneRemoved();
    const options = { now: NOW, retentionDays: 7, maxSizeMb: null };
    const conn = connectionOf(store);
    for (const slice of pruneSlices(
      conn,
      store.worktrees,
      storePaths(commonDir),
      options,
      counts,
    )) {
      slice();
    }
    expect(seen).toEqual([0, 0]);
    expect(counts).toEqual(noneRemoved());
  });
});

describe("a rule whose index the file lacks (row 021-33)", () => {
  it("waits for an opener to make it, and scans nothing meanwhile", () => {
    const { dir, store } = liveCodeStore();
    store.counts.put(code.count("unused"), OLD);
    const conn = codeConnection(dir);
    conn.db.exec("DROP INDEX states_by_blob");
    const counts = noCodeRemoved();
    for (const slice of pruneCodeSlices(conn, CODE_OPTIONS, counts)) slice();
    expect(counts.countsRemoved).toBe(0);
    expect(store.counts.get("unused", "typescript", 1)).not.toBeNull();
    // The next creating open makes it, and the prune after it deletes the count.
    code.open(dir);
    for (const slice of pruneCodeSlices(conn, CODE_OPTIONS, counts)) slice();
    expect(counts.countsRemoved).toBe(1);
  });
});

describe("a row that stops matching between the read and the delete (row 021-33)", () => {
  it("keeps a code-store count a file came to use", () => {
    const { dir, store } = liveCodeStore();
    store.counts.put(code.count("unused"), OLD);
    const conn = codeConnection(dir);
    const counts = noCodeRemoved();
    raceAfterRead(conn, pruneCodeSlices(conn, CODE_OPTIONS, counts), "counts", () =>
      store.files.upsertMany("w1", [code.file("src/b.ts", "unused")]),
    );
    expect(counts.countsRemoved).toBe(0);
    expect(store.counts.get("unused", "typescript", 1)).not.toBeNull();
  });

  it("keeps a code-store count a state came to name, though no file names its blob (review 0.1.568 B1)", () => {
    const { dir, store } = liveCodeStore();
    store.counts.put(code.count("unused"), OLD);
    const conn = codeConnection(dir);
    const counts = noCodeRemoved();
    raceAfterRead(conn, pruneCodeSlices(conn, CODE_OPTIONS, counts), "counts", () =>
      store.states.upsertMany([
        { ...stateOf("w1"), check: code.check("Ledger.open"), blob: "unused" },
      ]),
    );
    expect(Number(conn.get("SELECT count(*) AS n FROM files WHERE blob = 'unused'")?.n)).toBe(0);
    expect(counts.countsRemoved).toBe(0);
    expect(store.counts.get("unused", "typescript", 1)).not.toBeNull();
  });

  it("keeps a code-store check a state came to name", () => {
    const { dir, store } = liveCodeStore();
    const named = { ...stateOf("w1"), check: code.check("Ledger.close") };
    store.states.upsertMany([named]);
    const conn = codeConnection(dir);
    conn.run(
      "DELETE FROM states WHERE blob = ? AND check_id <> (SELECT min(check_id) FROM states)",
      "used",
    );
    const before = Number(conn.get("SELECT count(*) AS n FROM checks")?.n);
    const counts = noCodeRemoved();
    raceAfterRead(conn, pruneCodeSlices(conn, CODE_OPTIONS, counts), "checks", () =>
      store.states.upsertMany([named]),
    );
    expect(counts.checksRemoved).toBe(0);
    expect(Number(conn.get("SELECT count(*) AS n FROM checks")?.n)).toBe(before);
  });

  it("keeps a main-store check a known state came to name", () => {
    const commonDir = fakeCommonDir();
    const store = open(commonDir);
    store.knownStates.upsertMany([knownState("w1", testCheck("c1"))]);
    const conn = connectionOf(store);
    conn.run("DELETE FROM known_states");
    const counts = noneRemoved();
    const options = { now: NOW, retentionDays: 7, maxSizeMb: null };
    raceAfterRead(
      conn,
      pruneSlices(conn, store.worktrees, storePaths(commonDir), options, counts),
      "checks",
      () => store.knownStates.upsertMany([knownState("w1", testCheck("c1"))]),
    );
    expect(counts.checksRemoved).toBe(0);
    expect(store.knownStates.list("w1")).toHaveLength(1);
  });
});

function stateOf(worktreeId: string): CodeKnownState {
  return {
    worktreeId,
    check: code.check("Ledger.settle"),
    measure: "complexity",
    outcome: "fail",
    value: 23,
    threshold: 20,
    countedAt: 1,
    blob: "used",
    changedAt: 1,
  };
}
