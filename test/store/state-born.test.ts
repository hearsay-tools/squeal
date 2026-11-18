import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isStoreOpenFailure, openStore } from "../../src/core/store/open.js";
import { SCHEMA_VERSION } from "../../src/core/store/schema.js";
import { currentBirthMark, ensureBirthMarks } from "../../src/core/store/state-born.js";
import { connectionOf } from "../../src/core/store/store.js";
import type { Store } from "../../src/core/types/store.js";
import { fakeCommonDir, knownState, open, tempDir, testCheck, worktree } from "./helpers.js";

/*
 * Row 005-105 (005 `research/consumer-view-design.md`, design N): every known
 * state has a birth mark that triggers keep, whoever writes the states, and
 * nothing reads it yet.
 */

const WT = "wt-born";
const OTHER = "wt-other";

/** A store as the released Squeal leaves it: states, and none of this row's objects. */
function released(): { store: Store; commonDir: string } {
  const commonDir = fakeCommonDir();
  const store = open(commonDir);
  const live = tempDir();
  writeFileSync(join(live, ".git"), "gitdir: elsewhere\n");
  store.worktrees.upsert(worktree(WT, live));
  store.worktrees.upsert(worktree(OTHER, live));
  return { store, commonDir };
}

const write = (store: Store, worktreeId: string, ...names: string[]) =>
  store.knownStates.upsertMany(names.map((n) => knownState(worktreeId, testCheck(n))));

const checkId = (store: Store, name: string) =>
  Number(connectionOf(store).get("SELECT id FROM checks WHERE full_name = ?", name)?.id);

/** The birth mark of `worktreeId`'s state of the check `name`; `null` when none. */
const markOf = (store: Store, name: string, worktreeId = WT): number | null => {
  const row = connectionOf(store).get(
    "SELECT id FROM state_born WHERE worktree_id = ? AND check_id = ?",
    worktreeId,
    checkId(store, name),
  );
  return row === null ? null : Number(row.id);
};

/** The row ids of `worktreeId`'s checks whose state was born at or before `mark`. */
const checksBornBy = (store: Store, worktreeId: string, mark: number): ReadonlySet<number> =>
  new Set(
    connectionOf(store)
      .all("SELECT check_id FROM state_born WHERE worktree_id = ? AND id <= ?", worktreeId, mark)
      .map((row) => Number(row.check_id)),
  );

const objects = (store: Store) =>
  connectionOf(store)
    .all("SELECT name FROM sqlite_master WHERE name LIKE '%born%' ORDER BY name")
    .map((row) => String(row.name));

const bornRows = (store: Store, worktreeId: string) =>
  Number(
    connectionOf(store).get(
      "SELECT count(*) AS n FROM state_born WHERE worktree_id = ?",
      worktreeId,
    )?.n,
  );

describe("a known state's birth mark (row 005-105)", () => {
  it("is given to a new state and kept when an INSERT OR REPLACE rewrites it", () => {
    const { store } = released();
    ensureBirthMarks(store);
    write(store, WT, "a", "b");
    const a = markOf(store, "a");
    const b = markOf(store, "b");
    expect(a).not.toBeNull();
    expect(b).toBeGreaterThan(a ?? Infinity);
    // `upsertMany` is `INSERT OR REPLACE`: under an `OR IGNORE` trigger the mark would move.
    write(store, WT, "a", "a");
    store.knownStates.upsertMany([{ ...knownState(WT, testCheck("a")), outcome: "pass" }]);
    expect(markOf(store, "a")).toBe(a);
    expect(currentBirthMark(store)).toBe(b);
  });

  it("is new for a state retired and written again, above any earlier high mark", () => {
    const { store } = released();
    ensureBirthMarks(store);
    write(store, WT, "a", "b");
    const before = markOf(store, "a");
    const high = currentBirthMark(store) ?? 0;
    store.knownStates.removeMany(WT, [testCheck("a")]);
    expect(markOf(store, "a")).toBeNull();
    write(store, WT, "a");
    expect(markOf(store, "a")).toBeGreaterThan(high);
    expect(markOf(store, "a")).not.toBe(before);
  });

  it("is per worktree: the same check in two worktrees has two marks", () => {
    const { store } = released();
    ensureBirthMarks(store);
    write(store, WT, "a");
    write(store, OTHER, "a");
    expect(markOf(store, "a", OTHER)).toBeGreaterThan(markOf(store, "a") ?? Infinity);
  });

  it("splits a worktree's checks at a mark: born at or before it, or after", () => {
    const { store } = released();
    ensureBirthMarks(store);
    write(store, WT, "a", "b");
    write(store, OTHER, "c");
    const mark = currentBirthMark(store) ?? 0;
    write(store, WT, "d");
    write(store, WT, "a");
    expect(checksBornBy(store, WT, mark)).toEqual(
      new Set([checkId(store, "a"), checkId(store, "b")]),
    );
    expect(checksBornBy(store, WT, currentBirthMark(store) ?? 0)).toEqual(
      new Set(["a", "b", "d"].map((n) => checkId(store, n))),
    );
  });
});

describe("making the birth marks at a daemon's registration (row 005-105)", () => {
  it("gives the states of a released store their marks, with no user_version raise", () => {
    const { store, commonDir } = released();
    write(store, WT, "a", "b");
    write(store, OTHER, "a");
    expect(objects(store)).toEqual([]);
    expect(currentBirthMark(store)).toBeNull();

    ensureBirthMarks(store);
    expect(objects(store)).toEqual([
      "sqlite_autoindex_state_born_1",
      "squeal_born_known_states_delete",
      "squeal_born_known_states_insert",
      "state_born",
    ]);
    const high = currentBirthMark(store) ?? 0;
    expect(high).toBe(3);
    expect(checksBornBy(store, WT, high).size).toBe(2);
    expect(checksBornBy(store, OTHER, high).size).toBe(1);
    expect(connectionOf(store).get("PRAGMA user_version")?.user_version).toBe(SCHEMA_VERSION);

    // A second registration changes nothing.
    const a = markOf(store, "a");
    ensureBirthMarks(store);
    expect(markOf(store, "a")).toBe(a);
    expect(currentBirthMark(store)).toBe(high);

    // An opener of this checkout, which a released one is, opens the store as before.
    const again = openStore(commonDir, { busyTimeoutMs: 10_000 });
    if (isStoreOpenFailure(again)) throw new Error(JSON.stringify(again));
    expect(again.schemaVersion).toBe(SCHEMA_VERSION);
    expect(again.knownStates.list(WT)).toHaveLength(2);
    again.close();
  });

  it("is trusted only while the table and both triggers exist, and mends a lost trigger", () => {
    const { store } = released();
    ensureBirthMarks(store);
    write(store, WT, "a", "b");
    connectionOf(store).db.exec("DROP TRIGGER squeal_born_known_states_delete");
    expect(currentBirthMark(store)).toBeNull();
    store.knownStates.removeMany(WT, [testCheck("b")]);
    expect(bornRows(store, WT)).toBe(2);

    ensureBirthMarks(store);
    expect(currentBirthMark(store)).not.toBeNull();
    expect(bornRows(store, WT)).toBe(1);
  });

  it("leaves a store it has no connection to alone", () => {
    const fake = {} as Store;
    expect(() => ensureBirthMarks(fake)).not.toThrow();
    expect(currentBirthMark(fake)).toBeNull();
  });
});

/*
 * An older Squeal keeps the store: no repository, prune or open path changes in this row, so
 * this checkout's writers run the SQL a released one runs, and the triggers keep the marks.
 */
describe("a store with birth marks under the released writers (row 005-105)", () => {
  it("loses a removed worktree's marks with its states, and keeps another's", () => {
    const { store } = released();
    ensureBirthMarks(store);
    write(store, WT, "a", "b");
    write(store, OTHER, "a");
    store.worktrees.remove(WT);
    expect(bornRows(store, WT)).toBe(0);
    expect(bornRows(store, OTHER)).toBe(1);
  });

  it("loses a pruned worktree's marks in prune's batches", () => {
    const { store } = released();
    const gone = tempDir();
    store.worktrees.upsert(worktree("wt-gone", gone));
    ensureBirthMarks(store);
    write(store, "wt-gone", "a", "b", "c");
    write(store, WT, "a");
    expect(store.prune({ now: Date.now(), retentionDays: 7, maxSizeMb: null })).toMatchObject({
      worktreesRemoved: 1,
    });
    expect(bornRows(store, "wt-gone")).toBe(0);
    expect(bornRows(store, WT)).toBe(1);
    expect(markOf(store, "a")).not.toBeNull();
  });
});
