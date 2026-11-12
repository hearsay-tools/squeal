import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { Keeper } from "../../../src/core/code/gate/keep.js";
import type { Hasher } from "../../../src/core/hash/hasher.js";
import { StatCache } from "../../../src/core/hash/stat-cache.js";
import { testFileId } from "../../../src/core/keys/reverse-index.js";
import type { WorktreeKeys } from "../../../src/core/scheduler/keying.js";
import { describeHolders, lockHolders } from "../../../src/core/store/lock-holders.js";
import { isStoreOpenFailure, openStore } from "../../../src/core/store/open.js";
import { storePaths } from "../../../src/core/store/paths.js";
import type { CheckKey, TestFileRef } from "../../../src/core/types/keys.js";
import { DEFAULT_POLICY } from "../../../src/core/types/policy.js";
import type { RunReport } from "../../../src/core/types/runner.js";

/*
 * Spec 020 D17.5 (row 020-28, #192): a store whose write lock another
 * connection holds is retried in busy slices until a bound from the first
 * busy write; the wait names the holder, and a file still not written then
 * is told as not kept. Review 0.1.444 B2: from the first busy write on,
 * each file's inputs are read again after every pause and before each of
 * its writes, and a file whose bytes moved is not kept and counted apart.
 */

const A: TestFileRef = { project: "", path: "test/a.test.ts" };
const B: TestFileRef = { project: "", path: "test/b.test.ts" };
const KEY_A = "a".repeat(64) as CheckKey;
const KEY_B = "b".repeat(64) as CheckKey;
const RECORD = { v: 1, sources: [], unread: [] } as never;

/** Each test file's one input: `test/a.test.ts` reads `src/a.mjs`. */
const inputOf = (ref: TestFileRef) => ref.path.replace(/^test\/(\w+)\.test\.ts$/, "src/$1.mjs");

const STAT = { mtimeMs: 1, ctimeMs: 1, size: 1, inode: 1 };

/** Inputs that hold until `move` changes one: its stat and its hash then differ. */
function inputs() {
  const moved = new Set<string>();
  const hasher: Hasher = {
    stat: async (path) => (moved.has(path) ? { ...STAT, mtimeMs: 2, size: 2 } : STAT),
    hash: async (path) => (moved.has(path) ? "moved" : "h"),
    now: () => 1_000_000,
  };
  const cache = new StatCache([A, B].map((ref) => ({ path: inputOf(ref), ...STAT, hash: "h" })));
  const keys = {
    cache,
    stabilityPaths: (ref: TestFileRef) => [inputOf(ref)],
    beginRun: () => 1,
    endRun: () => {},
    observes: () => false,
    environmentFiles: () => [],
  } as unknown as WorktreeKeys;
  return { hasher, keys, move: (ref: TestFileRef) => moved.add(inputOf(ref)) };
}

function report(completed: readonly TestFileRef[]): RunReport {
  return {
    end: "completed",
    durationMs: 1,
    completedFiles: completed,
    results: [],
    fileErrors: [],
    failure: null,
  };
}

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A worktree root, a common directory with a store, and a connection holding its write lock. */
function lockedStore() {
  const root = mkdtempSync(join(tmpdir(), "squeal-keep-"));
  dirs.push(root);
  const commonDir = join(root, ".git");
  mkdirSync(commonDir);
  const store = openStore(commonDir);
  if (isStoreOpenFailure(store)) throw new Error(store.reason);
  store.close();
  const holder = new DatabaseSync(storePaths(commonDir).database);
  holder.exec("BEGIN IMMEDIATE");
  const release = () => {
    if (!holder.isOpen) return;
    holder.exec("ROLLBACK");
    holder.close();
  };
  return {
    root,
    commonDir,
    release,
    holder: describeHolders(lockHolders(storePaths(commonDir).database)),
  };
}

/** `files` run and flushed; `onBusy` runs at the busy note. */
async function kept(
  at: { root: string; commonDir: string },
  notes: string[],
  options: {
    readonly busyBoundMs: number;
    readonly files?: readonly (readonly [TestFileRef, CheckKey])[];
    readonly onBusy?: (moved: ReturnType<typeof inputs>) => void;
  },
): Promise<void> {
  const { busyBoundMs, files = [[A, KEY_A]], onBusy = () => {} } = options;
  const moving = inputs();
  const keep = new Keeper({
    root: at.root,
    commonDir: at.commonDir,
    policy: { ...DEFAULT_POLICY, complexity: { ...DEFAULT_POLICY.complexity, enabled: true } },
    head: async () => ({ head: "a".repeat(40), dirty: false }),
    note: (text) => {
      notes.push(text);
      if (text.startsWith("the store is busy")) onBusy(moving);
    },
    busyBoundMs,
  });
  keep.expect("vitest", moving.keys, moving.hasher, new Map(files));
  const refs = files.map(([ref]) => ref);
  await keep.ran({
    runner: "vitest",
    files: refs,
    report: report(refs),
    records: new Map(refs.map((ref) => [testFileId(ref), { record: RECORD }])),
  });
  await keep.flush();
}

/** The results stored at `key`, read once the lock is free. */
function resultsAt(commonDir: string, key: CheckKey = KEY_A): number {
  const db = new DatabaseSync(storePaths(commonDir).database, { readOnly: true });
  try {
    const row = db.prepare("SELECT count(*) AS n FROM results WHERE key = ?").get(key);
    return Number(row?.n);
  } finally {
    db.close();
  }
}

const BOTH = [
  [A, KEY_A],
  [B, KEY_B],
] as const;

describe("Keeper on a store another connection holds (spec 020 D17.3, D17.5)", () => {
  it("keeps the file once the lock is freed within the bound, and names the holder first", async () => {
    const locked = lockedStore();
    const notes: string[] = [];
    const freed = setTimeout(locked.release, 400);
    try {
      await kept(locked, notes, { busyBoundMs: 5_000 });
    } finally {
      clearTimeout(freed);
      locked.release();
    }
    expect(notes).toHaveLength(2);
    expect(notes[0]).toBe(
      `the store is busy (${locked.holder}); waiting up to 5 s to keep 1 completed test file: test/a.test.ts`,
    );
    expect(notes[1]).toMatch(/^the store was free after \d+(\.\d)? s: 1 completed test file kept$/);
    expect(resultsAt(locked.commonDir)).toBe(1);
  });

  it("keeps nothing while the lock outlasts the bound, and says who held it and what runs again", async () => {
    const locked = lockedStore();
    const notes: string[] = [];
    try {
      await kept(locked, notes, { busyBoundMs: 600 });
    } finally {
      locked.release();
    }
    expect(notes).toEqual([
      `the store is busy (${locked.holder}); waiting up to 0.6 s to keep 1 completed test file: test/a.test.ts`,
      `1 completed test file was not kept in the stores: the store stayed busy for 0.6 s (${locked.holder}); the next run will run it again`,
    ]);
    expect(resultsAt(locked.commonDir)).toBe(0);
  });

  it("does not keep a file whose input moved during the wait, and counts it apart (review 0.1.444 B2)", async () => {
    const locked = lockedStore();
    const notes: string[] = [];
    try {
      await kept(locked, notes, {
        busyBoundMs: 5_000,
        files: BOTH,
        onBusy: ({ move }) => {
          move(A);
          locked.release();
        },
      });
    } finally {
      locked.release();
    }
    expect(notes).toHaveLength(2);
    expect(notes[1]).toMatch(
      /^the store was free after \d+(\.\d)? s: 1 completed test file kept; 1 changed during the wait, so the next run will run it again$/,
    );
    expect([resultsAt(locked.commonDir, KEY_A), resultsAt(locked.commonDir, KEY_B)]).toEqual([
      0, 1,
    ]);
  });

  it("counts a moved file with the files to run again once the bound runs out", async () => {
    const locked = lockedStore();
    const notes: string[] = [];
    try {
      await kept(locked, notes, { busyBoundMs: 600, files: BOTH, onBusy: ({ move }) => move(A) });
    } finally {
      locked.release();
    }
    expect(notes).toEqual([
      `the store is busy (${locked.holder}); waiting up to 0.6 s to keep 2 completed test files: test/a.test.ts, test/b.test.ts`,
      `2 completed test files were not kept in the stores: the store stayed busy for 0.6 s (${locked.holder}), and 1 of them changed during the wait; the next run will run them again`,
    ]);
    expect([resultsAt(locked.commonDir, KEY_A), resultsAt(locked.commonDir, KEY_B)]).toEqual([
      0, 0,
    ]);
  });

  it("says a moved file was not kept when no write landed after the wait", async () => {
    const locked = lockedStore();
    const notes: string[] = [];
    try {
      await kept(locked, notes, { busyBoundMs: 5_000, onBusy: ({ move }) => move(A) });
    } finally {
      locked.release();
    }
    expect(notes.slice(1)).toEqual([
      "1 completed test file was not kept in the stores: it changed during the wait; the next run will run it again",
    ]);
    expect(resultsAt(locked.commonDir)).toBe(0);
  });
});
