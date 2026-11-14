import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as sleep } from "node:timers/promises";
import type { Hasher } from "../../../src/core/hash/hasher.js";
import { StatCache } from "../../../src/core/hash/stat-cache.js";
import type { WorktreeKeys } from "../../../src/core/scheduler/keying.js";
import { describeHolders, lockHolders } from "../../../src/core/store/lock-holders.js";
import { isStoreOpenFailure, openStore } from "../../../src/core/store/open.js";
import { storePaths } from "../../../src/core/store/paths.js";
import type { CheckKey, TestFileRef } from "../../../src/core/types/keys.js";
import type { RunReport } from "../../../src/core/types/runner.js";

/*
 * Spec 020 D17.5: the keeper's cases on a real store whose write lock a
 * connection of this process holds (`keep-busy.test.ts`, and row 020-59's
 * `keep-early.test.ts`). Row 020-30: each case waits until `lockHolders`
 * sees its lock before the gate starts.
 */

export const A: TestFileRef = { project: "", path: "test/a.test.ts" };
export const B: TestFileRef = { project: "", path: "test/b.test.ts" };
export const KEY_A = "a".repeat(64) as CheckKey;
export const KEY_B = "b".repeat(64) as CheckKey;
export const RECORD = { v: 1, sources: [], unread: [] } as never;

/** Each test file's one input: `test/a.test.ts` reads `src/a.mjs`. */
const inputOf = (ref: TestFileRef) => ref.path.replace(/^test\/(\w+)\.test\.ts$/, "src/$1.mjs");

const STAT = { mtimeMs: 1, ctimeMs: 1, size: 1, inode: 1 };

/** Inputs that hold until `move` changes one: its stat and its hash then differ. */
export function inputs() {
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

export function report(completed: readonly TestFileRef[]): RunReport {
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

/** Removes the cases' directories; for `afterEach`. */
export function removeStores(): void {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
}

/**
 * How long a case waits for `lockHolders` to see its lock: one read of
 * `/proc/locks` can miss it while other processes' locks come and go.
 */
const VISIBLE_MS = 5_000;

/**
 * Who holds `database`'s write lock, as `describeHolders` names it, once
 * `lockHolders` sees this process hold it; where it names no holder at all
 * (no `/proc`), what it says then.
 */
async function visibleHolder(database: string): Promise<string> {
  const until = Date.now() + VISIBLE_MS;
  for (;;) {
    const holders = lockHolders(database);
    if (holders === undefined || holders.some((h) => h.pid === process.pid && !h.waiting)) {
      return describeHolders(holders);
    }
    if (Date.now() >= until) {
      throw new Error(`lockHolders did not see this process hold ${database}`);
    }
    await sleep(10);
  }
}

/** A worktree root and a common directory with a store, no lock held. */
export function freeStore(): { readonly root: string; readonly commonDir: string } {
  const root = mkdtempSync(join(tmpdir(), "squeal-keep-"));
  dirs.push(root);
  const commonDir = join(root, ".git");
  mkdirSync(commonDir);
  const store = openStore(commonDir);
  if (isStoreOpenFailure(store)) throw new Error(store.reason);
  store.close();
  return { root, commonDir };
}

/** A connection holding the write lock of `commonDir`'s store, once `lockHolders` sees it. */
export async function holdStore(commonDir: string) {
  const holder = new DatabaseSync(storePaths(commonDir).database);
  holder.exec("BEGIN IMMEDIATE");
  const release = () => {
    if (!holder.isOpen) return;
    holder.exec("ROLLBACK");
    holder.close();
  };
  return { release, holder: await visibleHolder(storePaths(commonDir).database) };
}

/** A worktree root, a common directory with a store, and a connection holding its write lock. */
export async function lockedStore() {
  const at = freeStore();
  return { ...at, ...(await holdStore(at.commonDir)) };
}

/** The results stored at `key`, read once the lock is free. */
export function resultsAt(commonDir: string, key: CheckKey = KEY_A): number {
  const db = new DatabaseSync(storePaths(commonDir).database, { readOnly: true });
  try {
    const row = db.prepare("SELECT count(*) AS n FROM results WHERE key = ?").get(key);
    return Number(row?.n);
  } finally {
    db.close();
  }
}
