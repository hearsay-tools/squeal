import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { selectNamedFiles } from "../../src/cli/named-selection.js";
import { StoredClosures } from "../../src/cli/stored-closures.js";
import { CLOSURE_METHOD } from "../../src/core/keys/closure.js";
import {
  CLOSURE_WRITES_KEY,
  closureWrites,
  markClosureWrite,
  trustedClosureWrites,
} from "../../src/core/store/closure-writes.js";
import type { ExportedTestFile } from "../../src/core/store/transfer-bundle.js";
import { addClosures } from "../../src/core/store/transfer-rows.js";
import type { RelativePath } from "../../src/core/types/common.js";
import type { CheckKey } from "../../src/core/types/keys.js";
import type { Store } from "../../src/core/types/store.js";
import { claimAll, recordClosures, registerUnclaimed } from "./closure-trust.js";
import {
  ALL,
  HELPER,
  keys,
  storeClosures as putClosures,
  READERS,
  RUNTIME_READERS,
  SPAWNED,
  START,
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
  markClosureWrite(store);
}

/**
 * W and X share a store; W stored every closure but `SPAWNED`'s, which X
 * stored under its own key. W's daemon, the one registered, claimed its
 * states marker, so the closure marker is trusted.
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
  claimAll(store);
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

/** The files under `src/` that name `pattern`, relative to it. */
function sourcesNaming(pattern: RegExp): string[] {
  return readdirSync(SRC, { recursive: true, encoding: "utf8" })
    .filter((path) => path.endsWith(".ts") && pattern.test(readFileSync(join(SRC, path), "utf8")))
    .sort();
}

const SRC = join(import.meta.dirname, "../../src");

describe("the closure-write marker (row 011-44)", () => {
  it("is absent until a closure is written, and moves on each write of the transfer import", () => {
    const { store } = repoWith([], ALL);
    expect(closureWrites(store.meta)).toBeNull();
    expect(addClosures(store, [exported(SPAWNED)], "i1", NOW)).toBe(1);
    const first = closureWrites(store.meta);
    expect(first).toMatch(/^[0-9a-f]{16}$/);
    // A closure the store already has is not written, and leaves the marker.
    expect(addClosures(store, [exported(SPAWNED)], "i2", NOW)).toBe(0);
    expect(closureWrites(store.meta)).toBe(first);
    expect(addClosures(store, [exported(HELPER)], "i3", NOW)).toBe(1);
    expect(closureWrites(store.meta)).not.toBe(first);
  });

  it("is moved by both writers of closures, and by no other code", () => {
    // `TestFileRepo` is on the key-format guard's validity path: its writers bump instead.
    expect(sourcesNaming(/testFiles\.(put|remove)\(/)).toEqual([
      "core/scheduler/revision.ts",
      "core/store/transfer-rows.ts",
    ]);
    const read = (path: string) => readFileSync(join(SRC, path), "utf8");
    expect(read("core/scheduler/revision.ts")).toMatch(/if \(wrote\) markClosureWrite\(store\);/);
    expect(read("core/store/transfer-rows.ts")).toMatch(
      /if \(closures > 0\) markClosureWrite\(store\);/,
    );
    expect(sourcesNaming(/INTO test_files\b|DELETE FROM test_files\b|UPDATE test_files\b/)).toEqual(
      ["core/store/repos/test-files.ts"],
    );
  });

  it("is written in the closure's transaction: a rolled-back write leaves it as it was", () => {
    const { store } = repoWith([], ALL);
    recordClosures(store, [SPAWNED], "w");
    const before = closureWrites(store.meta);
    expect(() =>
      store.transaction(() => {
        recordClosures(store, [HELPER], "w");
        throw new Error("rolled back");
      }),
    ).toThrow("rolled back");
    expect(closureWrites(store.meta)).toBe(before);
  });
});

describe("the closure-write marker's trust (row 011-44, as row 011-45's states marker)", () => {
  it("is trusted while every registered daemon claimed its states marker", () => {
    const { store, x, xRoot, commonDir } = shared();
    expect(trustedClosureWrites(store)).toBe(closureWrites(store.meta));
    // A daemon of an earlier release registers: it claims no states marker.
    registerUnclaimed(store, x, xRoot, commonDir);
    expect(trustedClosureWrites(store)).toBeNull();
  });

  it("is not trusted with no daemon registered on the store", () => {
    const { store, w } = shared();
    const row = store.worktrees.get(w);
    if (row === null) throw new Error("no worktree row");
    store.worktrees.upsert({ ...row, daemon: null });
    expect(closureWrites(store.meta)).not.toBeNull();
    expect(trustedClosureWrites(store)).toBeNull();
  });

  it("sees a closure an unclaimed daemon wrote with no bump at the next selection", () => {
    const { root, store, w, x, xRoot, commonDir } = shared();
    const { store: reads, lists } = counted(store);
    const stored = new StoredClosures();
    const kept = () => selectNamedFiles(reads, w, root, root, [START], undefined, stored);
    expect(kept().files).toHaveLength(12);
    registerUnclaimed(store, x, xRoot, commonDir);
    // W's own closure of SPAWNED, written with no bump: the marker stays.
    const marker = closureWrites(store.meta);
    putClosures(store, [SPAWNED], w);
    expect(closureWrites(store.meta)).toBe(marker);
    expect(kept()).toEqual(selectNamedFiles(store, w, root, root, [START]));
    expect(kept().files).toHaveLength(13);
    expect(lists.n).toBe(3);
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
    recordClosures(store, [RUNTIME_READERS[0] ?? "", SPAWNED], w);
    expect(step("added")).toBe(13);
    expect(paths()).toEqual(READERS.slice().sort());
    // One list per closure write, and the first.
    expect(lists.n).toBe(3);
  });
});
