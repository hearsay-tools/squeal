import { describe, expect, it } from "vitest";
import { mainStoreResultKey } from "../../../src/core/code/coverage/runtime.js";
import {
  type OtherMachineKey,
  otherMachineKeysMetaKey,
  readOtherMachineKeys,
  recordOtherMachineKeys,
} from "../../../src/core/scheduler/other-machine-keys.js";
import type { WorktreeId } from "../../../src/core/types/common.js";
import type { CheckKey, TestFileRef } from "../../../src/core/types/keys.js";
import type { Store } from "../../../src/core/types/store.js";
import { fakeCommonDir, open, result, testCheck, worktree } from "../../store/helpers.js";

/*
 * Review 0.1.620-r2 S3 (row 026-19): the key a run on another machine stored
 * a file under, one entry per file, kept while the file is at the key the
 * run was for; and the coverage lookup over it, which gives that key only
 * for this worktree's stored result of that run.
 */

const WT = "wt" as WorktreeId;
const A: TestFileRef = { project: "", path: "a.test.ts" };
const B: TestFileRef = { project: "", path: "b.test.ts" };
const k = (text: string) => text as CheckKey;

function entry(testFile: TestFileRef, runId: string, current: string, stored: string) {
  return { testFile, runId, currentKey: k(current), storedKey: k(stored) } as OtherMachineKey;
}

/** A store whose worktree has `A` at `remote-a` and `B` at `remote-b`. */
function storeWithFiles(): Store {
  const store = open(fakeCommonDir());
  store.worktrees.upsert(worktree(WT, "/wt"));
  store.testFileKeys.upsertMany([
    { worktreeId: WT, testFile: A, key: k("remote-a"), revision: 1, pending: null },
    { worktreeId: WT, testFile: B, key: k("remote-b"), revision: 1, pending: null },
  ]);
  return store;
}

describe("the other-machine key of each file (review 0.1.620-r2 S3)", () => {
  it("keeps one entry per file, the newest run's, and drops a file cleared or re-keyed", () => {
    const store = storeWithFiles();
    const live = new Map([
      ["a.test.ts", k("remote-a")],
      ["b.test.ts", k("remote-b")],
    ]);
    const keyOf = (ref: TestFileRef) => live.get(ref.path);
    recordOtherMachineKeys(
      store,
      WT,
      [entry(A, "r1", "remote-a", "here-a1"), entry(B, "r1", "remote-b", "here-b")],
      [],
      keyOf,
    );
    recordOtherMachineKeys(store, WT, [entry(A, "r2", "remote-a", "here-a2")], [], keyOf);
    expect([...readOtherMachineKeys(store, WT).values()]).toEqual([
      entry(A, "r2", "remote-a", "here-a2"),
      entry(B, "r1", "remote-b", "here-b"),
    ]);

    // B moved to another key: its entry goes at the next write, and the row with its last entry.
    live.set("b.test.ts", k("edited"));
    recordOtherMachineKeys(store, WT, [], [], keyOf);
    expect([...readOtherMachineKeys(store, WT).keys()]).toHaveLength(1);
    recordOtherMachineKeys(store, WT, [], [A], keyOf);
    expect(readOtherMachineKeys(store, WT).size).toBe(0);
    expect(store.meta.get(otherMachineKeysMetaKey(WT))).toBeNull();
  });

  it("reads a row it cannot parse, or entries of another shape, as none", () => {
    const store = storeWithFiles();
    store.meta.set(otherMachineKeysMetaKey(WT), "{not json");
    expect(readOtherMachineKeys(store, WT).size).toBe(0);
    store.meta.set(otherMachineKeysMetaKey(WT), JSON.stringify([["", "a.test.ts", "r1", "x"], 4]));
    expect(readOtherMachineKeys(store, WT).size).toBe(0);
  });
});

describe("the coverage key of a run on another machine (review 0.1.620-r2 S3)", () => {
  /** `A`'s pass of run `runId` stored under `key` by `worktreeId`. */
  const pass = (key: string, runId: string, worktreeId: string = WT) =>
    result(testCheck("passes", A.path), key, { runId, worktreeId });

  it("gives the recorded key only for this worktree's stored result of that run", () => {
    const store = storeWithFiles();
    const resultKey = mainStoreResultKey(store, WT);
    const record = (stored: string) =>
      recordOtherMachineKeys(store, WT, [entry(A, "r1", "remote-a", stored)], [], () =>
        k("remote-a"),
      );

    // Recorded, but nothing stored under it: no key, never a minted result.
    record("here-a");
    expect(resultKey("r1", A)).toBeUndefined();
    // Another worktree's result of the same run id under that key: not ours.
    store.results.putMany([pass("here-a", "r1", "other-wt")]);
    expect(resultKey("r1", A)).toBeUndefined();
    store.results.putMany([pass("here-a", "r1")]);
    expect(resultKey("r1", A)).toBe("here-a");
    // Another run, another file: none.
    expect(resultKey("r0", A)).toBeUndefined();
    expect(resultKey("r1", B)).toBeUndefined();
    // A recorded key equal to the current one never stands for another machine's.
    record("remote-a");
    expect(resultKey("r1", A)).toBeUndefined();
  });

  it("gives none once the file is at another key than the run was for", () => {
    const store = storeWithFiles();
    const resultKey = mainStoreResultKey(store, WT);
    recordOtherMachineKeys(store, WT, [entry(A, "r1", "remote-a", "here-a")], [], () =>
      k("remote-a"),
    );
    store.results.putMany([pass("here-a", "r1")]);
    expect(resultKey("r1", A)).toBe("here-a");
    store.testFileKeys.upsertMany([
      { worktreeId: WT, testFile: A, key: k("edited"), revision: 2, pending: null },
    ]);
    expect(resultKey("r1", A)).toBeUndefined();
  });
});
