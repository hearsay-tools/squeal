import { describe, expect, it } from "vitest";
import { CLOSURE_METHOD } from "../../src/core/keys/closure.js";
import { connectionOf } from "../../src/core/store/store.js";
import {
  CLOSURE_WRITES_KEY,
  ensureWriteMarkers,
  statesMark,
  statesMarkerMetaKey,
  trustedClosureWrites,
} from "../../src/core/store/write-markers.js";
import type { RevisionNumber } from "../../src/core/types/common.js";
import type { CheckKey } from "../../src/core/types/keys.js";
import type { Store } from "../../src/core/types/store.js";
import { fakeCommonDir, open } from "./helpers.js";

/*
 * Rows 011-44 and 011-45, repaired after review 0.1.489 (B1): triggers move
 * the states marker on every write to a worktree's `known_states` and
 * `test_file_keys` rows, and the closure marker on every write to
 * `test_files`, whoever writes them; a reader trusts a marker only while
 * its triggers exist.
 */

const ID = "wt-marker";
const OTHER = "wt-other";
const CHECK = { kind: "test", project: "", testPath: "a.test.ts", fullName: "adds" } as const;
const FILE = { project: "", path: "a.test.ts" as never };

function seeded(): Store {
  const store = open(fakeCommonDir());
  for (const id of [ID, OTHER]) {
    store.worktrees.upsert({
      id,
      root: `/tmp/${id}`,
      commonDir: "/tmp/.git",
      isMain: id === ID,
      registeredAt: 1,
      daemon: null,
    });
  }
  return store;
}

const stateOf = (worktreeId: string, outcome: "pass" | "fail") => ({
  worktreeId,
  check: CHECK,
  outcome,
  validity: "current" as const,
  pendingPhase: null,
  observedAt: 1,
  commit: null,
  origin: { kind: "own" as const },
  durationMs: 5,
  location: null,
  summary: null,
  fingerprint: null,
});

const keyRow = (worktreeId: string, pending: "queued" | "running" | null) => ({
  worktreeId,
  testFile: FILE,
  key: "k" as CheckKey,
  revision: 1 as RevisionNumber,
  pending,
});

const closure = (by: string) => ({
  testFile: FILE,
  closure: { testFile: FILE, paths: [FILE.path], complete: false, method: CLOSURE_METHOD },
  updatedAt: 1,
  updatedBy: by,
});

const marker = (store: Store, id = ID) => store.meta.get(statesMarkerMetaKey(id));
const closures = (store: Store) => store.meta.get(CLOSURE_WRITES_KEY);
const sql = (store: Store, text: string, ...params: (string | number)[]) =>
  connectionOf(store).run(text, ...params);
const triggers = (store: Store) =>
  connectionOf(store)
    .all("SELECT name FROM sqlite_master WHERE type = 'trigger' ORDER BY name")
    .map((row) => String(row.name));

describe("the write markers' triggers (rows 011-44 and 011-45)", () => {
  it("are made once, outside the schema version, and set every marker when made", () => {
    const store = seeded();
    store.knownStates.upsertMany([stateOf(OTHER, "pass")]);
    const version = connectionOf(store).get("PRAGMA user_version");
    expect(triggers(store)).toEqual([]);
    expect(marker(store, OTHER)).toBeNull();

    ensureWriteMarkers(store);
    expect(triggers(store)).toHaveLength(9);
    expect(connectionOf(store).get("PRAGMA user_version")).toEqual(version);
    // The rows written before the triggers count as a write.
    expect(marker(store, OTHER)).toMatch(/^[0-9a-f]{16}$/);
    expect(closures(store)).toMatch(/^[0-9a-f]{16}$/);
    // A worktree with no rows has no marker yet.
    expect(marker(store)).toBeNull();

    const before = [marker(store, OTHER), closures(store)];
    ensureWriteMarkers(store);
    expect([marker(store, OTHER), closures(store)]).toEqual(before);
  });

  it("move a worktree's states marker on each write of its states or key rows, by any writer", () => {
    const store = seeded();
    ensureWriteMarkers(store);
    const writes: [string, () => void][] = [
      ["state insert", () => store.knownStates.upsertMany([stateOf(ID, "fail")])],
      ["state replace", () => store.knownStates.upsertMany([stateOf(ID, "pass")])],
      ["raw state update", () => sql(store, "UPDATE known_states SET outcome = 'fail'")],
      ["state removal", () => store.knownStates.removeMany(ID, [CHECK])],
      ["key insert", () => store.testFileKeys.upsertMany([keyRow(ID, "running")])],
      ["key release", () => store.testFileKeys.releaseRunning(ID)],
      ["key removal", () => store.testFileKeys.remove(ID, [FILE])],
    ];
    for (const [name, write] of writes) {
      const before = marker(store);
      const other = marker(store, OTHER);
      write();
      expect(marker(store), name).not.toBe(before);
      expect(marker(store), name).not.toBeNull();
      expect(marker(store, OTHER), name).toBe(other);
    }
    // A write that changes no row moves nothing.
    const before = marker(store);
    store.testFileKeys.releaseRunning(ID);
    store.knownStates.upsertMany([]);
    expect(marker(store)).toBe(before);
  });

  it("move the closure marker on each write of a closure, removals included", () => {
    const store = seeded();
    ensureWriteMarkers(store);
    const writes: [string, () => void][] = [
      ["put", () => store.testFiles.put(closure(ID))],
      ["replace", () => store.testFiles.put(closure(OTHER))],
      ["raw update", () => sql(store, "UPDATE test_files SET updated_at = 2")],
      ["remove", () => store.testFiles.remove(FILE)],
    ];
    for (const [name, write] of writes) {
      const before = closures(store);
      write();
      expect(closures(store), name).not.toBe(before);
    }
  });

  it("move a marker in the write's own transaction: a rolled-back write leaves it", () => {
    const store = seeded();
    ensureWriteMarkers(store);
    store.knownStates.upsertMany([stateOf(ID, "pass")]);
    const before = [marker(store), closures(store)];
    expect(() =>
      store.transaction(() => {
        store.knownStates.upsertMany([stateOf(ID, "fail")]);
        store.testFiles.put(closure(ID));
        throw new Error("rolled back");
      }),
    ).toThrow("rolled back");
    expect([marker(store), closures(store)]).toEqual(before);
  });
});

describe("a reader's trust in the write markers (rows 011-44 and 011-45)", () => {
  it("holds while the triggers exist and the marker has a row", () => {
    const store = seeded();
    store.knownStates.upsertMany([stateOf(ID, "pass")]);
    expect(statesMark(store, ID)).toBeNull();
    expect(trustedClosureWrites(store)).toBeNull();
    ensureWriteMarkers(store);
    expect(statesMark(store, ID)).toBe(marker(store));
    expect(trustedClosureWrites(store)).toBe(closures(store));
    expect(statesMark(store, OTHER)).toBeNull();
  });

  it("each marker needs its own table's triggers", () => {
    const store = seeded();
    store.knownStates.upsertMany([stateOf(ID, "pass")]);
    ensureWriteMarkers(store);
    sql(store, "DROP TRIGGER squeal_marker_test_file_keys_delete");
    expect(statesMark(store, ID)).toBeNull();
    expect(trustedClosureWrites(store)).not.toBeNull();
    ensureWriteMarkers(store);
    sql(store, "DROP TRIGGER squeal_marker_test_files_insert");
    expect(statesMark(store, ID)).not.toBeNull();
    expect(trustedClosureWrites(store)).toBeNull();
  });

  it("ends with its worktree: the removal drops the marker row after the rows", () => {
    const store = seeded();
    ensureWriteMarkers(store);
    store.knownStates.upsertMany([stateOf(ID, "pass")]);
    expect(statesMark(store, ID)).not.toBeNull();
    store.worktrees.remove(ID);
    expect(marker(store)).toBeNull();
    expect(statesMark(store, ID)).toBeNull();
  });

  it("is never given by a store a test made without a connection", () => {
    const store = seeded();
    ensureWriteMarkers(store);
    store.knownStates.upsertMany([stateOf(ID, "pass")]);
    const fake = { ...store };
    expect(statesMark(fake, ID)).toBeNull();
    expect(trustedClosureWrites(fake)).toBeNull();
    ensureWriteMarkers(fake);
  });
});
