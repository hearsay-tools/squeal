import { afterEach, describe, expect, it } from "vitest";
import { readHeld, startView } from "../../src/cli/status-wait-held.js";
import { readClasses, readVerdict } from "../../src/cli/verdict.js";
import type { CheckKey, RevisionNumber, Store } from "../../src/core/types/index.js";
import { check, fakeRepo, seedStore, state } from "../status/helpers.js";

/*
 * Task 011-42: a selection of no test files reads no state and no row and
 * counts none, as when `run --all` requests every listed file, a lane has no
 * files, or a wait's window names none.
 */

const stores: Store[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});

function seeded(): { store: Store; id: string } {
  const repo = fakeRepo();
  const store = seedStore(repo);
  stores.push(store);
  const id = repo.mainId;
  store.testFileKeys.upsertMany([
    {
      worktreeId: id,
      testFile: { project: "", path: "a.test.ts" },
      key: "key-a" as CheckKey,
      revision: 1 as RevisionNumber,
      pending: null,
    },
  ]);
  store.knownStates.upsertMany([state(id, check("a.test.ts", "works"))]);
  return { store, id };
}

describe("an empty selection of test files", () => {
  it("readClasses counts no file", () => {
    const { store, id } = seeded();
    const classes = readClasses(store, id, []);
    expect(classes.testFiles).toBe(0);
    expect(classes.byClass).toEqual({ current: 0, pending: 0, stale: 0, unknown: 0 });
  });

  it("readVerdict counts no file and no failure", () => {
    const { store, id } = seeded();
    const verdict = readVerdict(store, id, []);
    expect(verdict.testFiles).toBe(0);
    expect(verdict.failures).toEqual({ tests: 0, testFiles: 0 });
  });

  it("readHeld reads no state or row, and the worktree's revision", () => {
    const { store, id } = seeded();
    const held = readHeld(store, id, startView(store.knownStates.list(id)), []);
    expect(held.states).toEqual([]);
    expect(held.keys).toEqual([]);
    expect(held.news).toEqual([]);
  });

  it("a selection of every file still counts them", () => {
    const { store, id } = seeded();
    const files = [{ project: "", path: "a.test.ts" }];
    expect(readClasses(store, id, files).byClass.current).toBe(1);
    expect(readVerdict(store, id, files).byClass.current).toBe(1);
  });
});
