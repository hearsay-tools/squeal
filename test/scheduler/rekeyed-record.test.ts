import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { testFileId } from "../../src/core/keys/index.js";
import type { SchedulerContext } from "../../src/core/scheduler/context.js";
import { Ledger } from "../../src/core/scheduler/ledger.js";
import {
  pruneRekeyed,
  readRekeyed,
  rekeyedMetaKey,
} from "../../src/core/scheduler/rekeyed-record.js";
import { createStateSink } from "../../src/core/state/index.js";
import { isStoreOpenFailure, openStore } from "../../src/core/store/index.js";
import {
  type CheckKey,
  DEFAULT_POLICY,
  type Store,
  type TestFileRef,
  type WorktreeId,
} from "../../src/core/types/index.js";

/*
 * Review wave 13u, B1 (task 001-238): the ledger's commit records the
 * scheduler's re-key attribution in the store, so a hook's delivery reads
 * what `status --wait` reads. A key moved back before its result keeps its
 * earliest unresolved revision; a result resolves it; a removed file goes.
 */

const WORKTREE = "wt-238" as WorktreeId;
const FILE: TestFileRef = { project: "", path: "test/a.test.ts" };
const ID = testFileId(FILE);
const NOTHING = new Set<never>();
const cleanups: (() => void)[] = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

function open(): Store {
  const dir = mkdtempSync(join(tmpdir(), "sq-238-"));
  const store = openStore(dir, { busyTimeoutMs: 10_000 });
  if (isStoreOpenFailure(store)) throw new Error(`store: ${JSON.stringify(store)}`);
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  cleanups.push(() => store.close());
  return store;
}

/** A ledger over `store` whose key index answers `keys`. */
function ledgerOf(store: Store, keys: Map<string, CheckKey>): Ledger {
  const context = {
    store,
    sink: createStateSink(store),
    worktreeId: WORKTREE,
    policy: DEFAULT_POLICY,
    now: Date.now,
    keys: {
      index: { key: (ref: TestFileRef) => keys.get(ref.path) ?? null },
      removeTestFile: () => {},
    },
  } as unknown as SchedulerContext;
  return new Ledger(context);
}

const key = (c: string) => c.repeat(64) as CheckKey;

describe("the ledger's re-key record (task 001-238)", () => {
  it("keeps a key moved back before its result open, until a result lands", () => {
    const store = open();
    const keys = new Map([[FILE.path, key("a")]]);
    const ledger = ledgerOf(store, keys);
    ledger.addFile(FILE);
    // The baseline's key: no edit, nothing recorded.
    ledger.settle([FILE], NOTHING);
    ledger.commit();
    expect(readRekeyed(store, WORKTREE).size).toBe(0);

    keys.set(FILE.path, key("b"));
    ledger.settle([FILE], NOTHING, { keyedAt: 2 });
    ledger.commit();
    expect(readRekeyed(store, WORKTREE).get(ID)).toEqual({ open: 2, last: 2 });

    keys.set(FILE.path, key("a"));
    ledger.settle([FILE], NOTHING, { keyedAt: 3 });
    ledger.commit();
    expect(readRekeyed(store, WORKTREE).get(ID)).toEqual({ open: 2, last: 3 });

    const file = ledger.file(FILE);
    if (!file) throw new Error("no file");
    ledger.applyResults(file, key("a"), [], null);
    ledger.commit();
    expect(readRekeyed(store, WORKTREE).get(ID)).toEqual({ open: null, last: 3 });

    ledger.removeFile(file);
    ledger.commit();
    expect(store.meta.get(rekeyedMetaKey(WORKTREE))).toBeNull();
  });

  it("prunes only resolved entries at or before a revision", () => {
    const store = open();
    store.meta.set(
      rekeyedMetaKey(WORKTREE),
      JSON.stringify({ done: [null, 2], later: [null, 5], owed: [1, 2], bad: "x" }),
    );
    pruneRekeyed(store, WORKTREE, 3);
    expect([...readRekeyed(store, WORKTREE).keys()].sort()).toEqual(["later", "owed"]);
  });

  it("reads an unreadable row as empty", () => {
    const store = open();
    store.meta.set(rekeyedMetaKey(WORKTREE), "{");
    expect(readRekeyed(store, WORKTREE).size).toBe(0);
  });
});
