import { describe, expect, it } from "vitest";
import { selectNamedFiles } from "../../src/cli/named-selection.js";
import { StoredClosures } from "../../src/cli/stored-closures.js";
import { CLOSURE_METHOD } from "../../src/core/keys/closure.js";
import { CLOSURE_WRITES_KEY, closureWrites } from "../../src/core/store/closure-writes.js";
import type { Store } from "../../src/core/types/store.js";
import {
  ALL,
  HELPER,
  keys,
  READERS,
  RUNTIME_READERS,
  SPAWNED,
  START,
  storeClosures,
  TYPES,
} from "./source-path-fixture.js";
import { NOW, ref, repoWith } from "./status-wait-fixture.js";

/*
 * Row 011-44: the closure-write marker, and the stored closures a wait keeps
 * across its polls. A selection with the kept closures equals a fresh full
 * read's, after a closure that adds or drops the path, and after a key that
 * moves without a closure write.
 */

/** `store` with its `testFiles.list` calls counted in `lists`. */
function counted(store: Store): { store: Store; lists: { n: number } } {
  const lists = { n: 0 };
  const testFiles = {
    ...store.testFiles,
    list: () => {
      lists.n++;
      return store.testFiles.list();
    },
  };
  return { store: { ...store, testFiles } as Store, lists };
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

/** W and X share a store; W stored every closure but `SPAWNED`'s, which X stored under its own key. */
function shared() {
  const { repo, store } = repoWith([], ALL);
  const w = repo.mainId;
  const x = repo.addWorktree("other").id;
  storeClosures(
    store,
    ALL.filter((p) => p !== SPAWNED),
    w,
  );
  storeClosures(store, [SPAWNED], x);
  keys(store, x, [SPAWNED], "x1");
  return { root: repo.main, store, w, x };
}

describe("the closure-write marker (row 011-44)", () => {
  it("is absent until a closure is written, and moves on each put and remove", () => {
    const { store } = repoWith([], ALL);
    expect(closureWrites(store.meta)).toBeNull();
    storeClosures(store, [SPAWNED], "w");
    const first = closureWrites(store.meta);
    expect(first).toMatch(/^[0-9a-f]{16}$/);
    storeClosures(store, [SPAWNED], "w");
    const second = closureWrites(store.meta);
    expect(second).not.toBe(first);
    store.testFiles.remove(ref(SPAWNED));
    expect(closureWrites(store.meta)).not.toBe(second);
  });

  it("is written in the closure's transaction: a rolled-back write leaves it as it was", () => {
    const { store } = repoWith([], ALL);
    storeClosures(store, [SPAWNED], "w");
    const before = closureWrites(store.meta);
    expect(() =>
      store.transaction(() => {
        storeClosures(store, [HELPER], "w");
        throw new Error("rolled back");
      }),
    ).toThrow("rolled back");
    expect(closureWrites(store.meta)).toBe(before);
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
    storeClosures(store, [SPAWNED], w);
    stored.read(reads);
    stored.read(reads);
    expect(lists.n).toBe(2);
  });

  it("reads the closure list each time from a store with no marker, as before", () => {
    const { store } = shared();
    store.meta.delete(CLOSURE_WRITES_KEY);
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
    const full = () => selectNamedFiles(store, w, root, root, [START]);
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
    storeClosures(store, [RUNTIME_READERS[0] ?? "", SPAWNED], w);
    expect(step("added")).toBe(13);
    expect(paths()).toEqual(READERS.slice().sort());
    // One list per closure write, and the first.
    expect(lists.n).toBe(3);
  });
});
