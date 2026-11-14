import { describe, expect, it } from "vitest";
import { selectNamedFiles } from "../../src/cli/named-selection.js";
import { StoredClosures } from "../../src/cli/stored-closures.js";
import { CLOSURE_METHOD } from "../../src/core/keys/closure.js";
import { connectionOf } from "../../src/core/store/store.js";
import type { ExportedTestFile } from "../../src/core/store/transfer-bundle.js";
import { addClosures } from "../../src/core/store/transfer-rows.js";
import { CLOSURE_WRITES_KEY, trustedClosureWrites } from "../../src/core/store/write-markers.js";
import type { RelativePath } from "../../src/core/types/common.js";
import type { CheckKey } from "../../src/core/types/keys.js";
import type { Store } from "../../src/core/types/store.js";
import { armMarkers, recordClosures } from "./closure-trust.js";
import {
  ALL,
  HELPER,
  keys,
  READERS,
  RUNTIME_READERS,
  SPAWNED,
  START,
  TYPES,
} from "./source-path-fixture.js";
import { NOW, ref, repoWith } from "./status-wait-fixture.js";

/*
 * Row 011-44: the closure-write marker, which the triggers on `test_files`
 * move (repaired after review 0.1.489), and the stored closures a wait keeps
 * across its polls. A selection with the kept closures equals a fresh full
 * read's, after a closure that adds or drops the path, and after a key that
 * moves without a closure write.
 */

/** The closure marker's row as it stands, trusted or not. */
const closureWrites = (store: Store) => store.meta.get(CLOSURE_WRITES_KEY);

/**
 * `store` with its `testFiles.list` calls counted in `lists`, in place: it
 * stays the store `openStore` opened, with its connection.
 */
function counted(store: Store): { store: Store; lists: { n: number } } {
  const lists = { n: 0 };
  const { testFiles } = store;
  (store as { testFiles: Store["testFiles"] }).testFiles = {
    ...testFiles,
    list: () => {
      lists.n++;
      return testFiles.list();
    },
  };
  return { store, lists };
}

/** `path`'s closure without `START`, by `by`: a recorded closure that drops it. */
function dropStart(store: Store, path: string, by: string) {
  store.testFiles.put({
    testFile: ref(path),
    closure: {
      testFile: ref(path),
      paths: [path, TYPES] as never,
      complete: false,
      method: CLOSURE_METHOD,
    },
    updatedAt: NOW,
    updatedBy: by,
  });
}

/**
 * W and X share a store; W stored every closure but `SPAWNED`'s, which X
 * stored under its own key. W's daemon, of this release, made the marker
 * triggers, so the closure marker is trusted.
 */
function shared() {
  const { repo, store } = repoWith([], ALL);
  const w = repo.mainId;
  const other = repo.addWorktree("other");
  const x = other.id;
  recordClosures(
    store,
    ALL.filter((p) => p !== SPAWNED),
    w,
  );
  recordClosures(store, [SPAWNED], x);
  keys(store, x, [SPAWNED], "x1");
  armMarkers(store);
  return { root: repo.main, store, w, x, xRoot: other.root, commonDir: repo.commonDir };
}

/** The transfer import's closure of `path`, which `addClosures` adds when the store has none. */
function exported(path: string): ExportedTestFile {
  return {
    project: "",
    path: path as RelativePath,
    key: `k-${path}` as CheckKey,
    closure: { paths: [path, TYPES] as RelativePath[], complete: false, method: CLOSURE_METHOD },
    observed: {},
  };
}

describe("the closure-write marker (row 011-44)", () => {
  it("is set when the triggers are made, and moves on each write of the transfer import", () => {
    const { store } = repoWith([], ALL);
    expect(closureWrites(store)).toBeNull();
    // With no triggers a write moves nothing: an earlier release's store.
    expect(addClosures(store, [exported(TYPES)], "i0", NOW)).toBe(1);
    expect(closureWrites(store)).toBeNull();
    armMarkers(store);
    const armed = closureWrites(store);
    expect(armed).toMatch(/^[0-9a-f]{16}$/);
    expect(addClosures(store, [exported(SPAWNED)], "i1", NOW)).toBe(1);
    const first = closureWrites(store);
    expect(first).not.toBe(armed);
    // A closure the store already has is not written, and leaves the marker.
    expect(addClosures(store, [exported(SPAWNED)], "i2", NOW)).toBe(0);
    expect(closureWrites(store)).toBe(first);
    expect(addClosures(store, [exported(HELPER)], "i3", NOW)).toBe(1);
    expect(closureWrites(store)).not.toBe(first);
    // A removal moves it too.
    const before = closureWrites(store);
    store.testFiles.remove(ref(HELPER));
    expect(closureWrites(store)).not.toBe(before);
  });

  it("is written in the closure's transaction: a rolled-back write leaves it as it was", () => {
    const { store } = repoWith([], ALL);
    armMarkers(store);
    recordClosures(store, [SPAWNED], "w");
    const before = closureWrites(store);
    expect(() =>
      store.transaction(() => {
        recordClosures(store, [HELPER], "w");
        throw new Error("rolled back");
      }),
    ).toThrow("rolled back");
    expect(closureWrites(store)).toBe(before);
  });
});

describe("the closure-write marker's trust (rows 011-44 and 011-45)", () => {
  it("is trusted while the triggers on test_files exist", () => {
    const { store } = shared();
    expect(trustedClosureWrites(store)).toBe(closureWrites(store));
    expect(trustedClosureWrites(store)).not.toBeNull();
  });

  it("is not trusted once a trigger is dropped, or with no marker row", () => {
    const { store } = shared();
    connectionOf(store).db.exec("DROP TRIGGER squeal_marker_test_files_delete");
    expect(closureWrites(store)).not.toBeNull();
    expect(trustedClosureWrites(store)).toBeNull();
    armMarkers(store);
    expect(trustedClosureWrites(store)).not.toBeNull();
    store.meta.delete(CLOSURE_WRITES_KEY);
    expect(trustedClosureWrites(store)).toBeNull();
  });

  it("is not trusted from a store a test made without a connection", () => {
    const { store } = shared();
    expect(trustedClosureWrites({ ...store })).toBeNull();
  });
});

describe("a wait's stored closures (row 011-44)", () => {
  it("reads the closure list again only after a closure was written", () => {
    const { store, w } = shared();
    const { store: reads, lists } = counted(store);
    const stored = new StoredClosures();
    stored.read(reads);
    stored.read(reads);
    expect(lists.n).toBe(1);
    recordClosures(store, [SPAWNED], w);
    stored.read(reads);
    stored.read(reads);
    expect(lists.n).toBe(2);
  });

  it("reads the closure list each time from a store with no marker triggers, as before", () => {
    const { store } = repoWith([], ALL);
    recordClosures(store, ALL, "w");
    const { store: reads, lists } = counted(store);
    const stored = new StoredClosures();
    for (let i = 0; i < 3; i++) stored.read(reads);
    expect(lists.n).toBe(3);
  });

  it("selects as a full read does after each closure write and key move", () => {
    const { root, store, w, x } = shared();
    const { store: reads, lists } = counted(store);
    const stored = new StoredClosures();
    const kept = () => selectNamedFiles(reads, w, root, root, [START], undefined, stored);
    // The same store counts in place: a full read's list is not the kept selection's.
    const full = () => {
      const n = lists.n;
      const selection = selectNamedFiles(store, w, root, root, [START]);
      lists.n = n;
      return selection;
    };
    const paths = () => kept().files.map((f) => f.path);
    const step = (name: string) => {
      expect(kept(), name).toEqual(full());
      return paths().length;
    };
    // X's closure of SPAWNED is not W's: W's key for it differs.
    expect(step("start")).toBe(12);
    // A key move with no closure write: W's key for SPAWNED is now X's.
    keys(store, w, [SPAWNED], "x1");
    expect(step("W keyed as X")).toBe(13);
    // X moves its key: the record is no longer W's.
    keys(store, x, [SPAWNED], "x2");
    expect(step("X re-keyed")).toBe(12);
    // A recorded closure that drops the path.
    dropStart(store, RUNTIME_READERS[0] ?? "", w);
    expect(step("dropped")).toBe(11);
    // A recorded closure that adds it.
    recordClosures(store, [RUNTIME_READERS[0] ?? "", SPAWNED], w);
    expect(step("added")).toBe(13);
    expect(paths()).toEqual(READERS.slice().sort());
    // One list per closure write, and the first.
    expect(lists.n).toBe(3);
  });
});
