import { AsyncLocalStorage } from "node:async_hooks";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { COVERAGE_RECORD_VERSION, decodeRecord } from "../../../src/core/code/coverage/record.js";
import { Keeper } from "../../../src/core/code/gate/keep.js";
import { isCodeStoreOpenFailure, openCodeStore } from "../../../src/core/code/store/open.js";
import { DaemonWrites } from "../../../src/core/daemon/busy-writes.js";
import { createHandlers } from "../../../src/core/daemon/handlers.js";
import { keepInDaemon } from "../../../src/core/daemon/keep-request.js";
import { acquireDaemonLock } from "../../../src/core/daemon/lock.js";
import { createDaemonServer } from "../../../src/core/daemon/server.js";
import { worktreeIdFor } from "../../../src/core/fs/git-layout.js";
import type { Hasher } from "../../../src/core/hash/hasher.js";
import { StatCache } from "../../../src/core/hash/stat-cache.js";
import { testFileId } from "../../../src/core/keys/reverse-index.js";
import type { WorktreeKeys } from "../../../src/core/scheduler/keying.js";
import { BusyWaits } from "../../../src/core/store/busy.js";
import { describeHolders, lockHolders } from "../../../src/core/store/lock-holders.js";
import { isStoreOpenFailure, openStore } from "../../../src/core/store/open.js";
import { lockFileFor, storePaths } from "../../../src/core/store/paths.js";
import type { AbsolutePath, EpochMs } from "../../../src/core/types/common.js";
import type { KeepRequest } from "../../../src/core/types/daemon-writes.js";
import type { CheckKey, TestFileRef } from "../../../src/core/types/keys.js";
import { DEFAULT_POLICY } from "../../../src/core/types/policy.js";
import type { RunReport } from "../../../src/core/types/runner.js";

/*
 * Spec 021 D15 (row 021-20, part two): while a daemon holds the worktree's
 * lock and serves it, the code gate's keeper sends each try of each write
 * to it, and the daemon writes in its retried path, so the gate makes no
 * write transaction of its own. Spec 020 D17.5 (row 020-28) holds as with
 * no daemon: the files are written by `flush` once the report is out, the
 * wait names the lock's holder first, the bound counts from the first
 * refused write, and a file whose inputs moved during the wait is not
 * kept. A daemon without this request keeps nothing of the gate's, as
 * before.
 */

const A: TestFileRef = { project: "", path: "test/a.test.ts" };
const B: TestFileRef = { project: "", path: "test/b.test.ts" };
const KEY_A = "a".repeat(64) as CheckKey;
const KEY_B = "b".repeat(64) as CheckKey;
const RECORD = { v: 1, sources: [], unread: ["src/a.mjs"] } as never;
const POLICY = { ...DEFAULT_POLICY, complexity: { ...DEFAULT_POLICY.complexity, enabled: true } };
const BOTH = [
  [A, KEY_A],
  [B, KEY_B],
] as const;

const inputOf = (ref: TestFileRef) => ref.path.replace(/^test\/(\w+)\.test\.ts$/, "src/$1.mjs");
const STAT = { mtimeMs: 1, ctimeMs: 1, size: 1, inode: 1 };

/** Inputs that hold until `move` changes one, as `keep-busy.test.ts` makes them. */
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

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  vi.restoreAllMocks();
});

/** The daemon's own async context: its writes are the daemon's. */
const daemonSide = new AsyncLocalStorage<true>();

interface Served {
  readonly root: AbsolutePath;
  readonly commonDir: AbsolutePath;
  /** The keep requests the daemon took. */
  readonly keeps: KeepRequest[];
  /** Holds the store's write lock from another connection until the returned release. */
  hold(): { readonly holder: string; release(): void };
}

/**
 * A worktree whose daemon holds its lock and serves its socket in this
 * process, with the daemon's handlers and its `keepInDaemon` on a store
 * connection of its own; `takesKeeps` false: a daemon before this request.
 */
async function served(takesKeeps = true): Promise<Served> {
  const root = mkdtempSync(join(tmpdir(), "squeal-keep-d-")) as AbsolutePath;
  const commonDir = join(root, ".git") as AbsolutePath;
  mkdirSync(commonDir);
  const worktreeId = worktreeIdFor(root);
  const store = openStore(commonDir);
  if (isStoreOpenFailure(store)) throw new Error(store.reason);
  const socketPath = join(root, "d.sock") as AbsolutePath;
  const keeps: KeepRequest[] = [];
  const writes = new DaemonWrites(new BusyWaits({ now: Date.now, note: () => {} }));
  const requestKeep = (request: KeepRequest) => {
    keeps.push(request);
    return daemonSide.run(true, () =>
      keepInDaemon(
        { commonDir, worktreeId, store, policy: () => POLICY, writes, now: Date.now },
        request,
      ),
    );
  };
  const server = await createDaemonServer(
    socketPath,
    createHandlers({
      worktreeId,
      root,
      squealVersion: "0.0.0-test",
      startedAt: 1 as EpochMs,
      token: "t",
      phase: () => "ready",
      requestFullSuite: () => Promise.reject(new Error("not in this test")),
      onActivity: () => {},
      onStop: () => {},
      onStepDown: () => {},
      storeSchema: store.schemaVersion,
      ...(takesKeeps ? { requestKeep } : {}),
    }),
  );
  store.worktrees.upsert({
    id: worktreeId,
    root,
    commonDir,
    isMain: true,
    registeredAt: 1,
    daemon: null,
  });
  store.worktrees.setDaemon(worktreeId, {
    socketPath,
    startedAt: 1 as EpochMs,
    heartbeatAt: Date.now() as EpochMs,
    heartbeatIntervalMs: 3_600_000,
    squealVersion: "0.0.0-test",
  });
  const lock = acquireDaemonLock(lockFileFor(commonDir, worktreeId));
  if (lock === null) throw new Error("the worktree's lock is held");
  cleanups.push(async () => {
    lock.release();
    await server.close();
    store.close();
    rmSync(root, { recursive: true, force: true });
  });
  const hold = () => {
    const holder = new DatabaseSync(storePaths(commonDir).database);
    holder.exec("BEGIN IMMEDIATE");
    const release = () => {
      if (!holder.isOpen) return;
      holder.exec("ROLLBACK");
      holder.close();
    };
    cleanups.push(release);
    return { holder: describeHolders(lockHolders(storePaths(commonDir).database)), release };
  };
  return { root, commonDir, keeps, hold };
}

/**
 * Write transactions this process opens on `store.sqlite` or `code.sqlite`
 * outside the daemon's context until `stop`: the gate's own writes.
 */
function countGateWrites(): { stop(): number } {
  const exec = DatabaseSync.prototype.exec;
  let count = 0;
  const spy = vi.spyOn(DatabaseSync.prototype, "exec").mockImplementation(function (
    this: DatabaseSync,
    sql: string,
  ) {
    const file = this.location() ?? "";
    const store = file.endsWith("store.sqlite") || file.endsWith("code.sqlite");
    if (store && /^\s*BEGIN\s+IMMEDIATE/i.test(sql) && daemonSide.getStore() !== true) count++;
    return exec.call(this, sql);
  });
  return {
    stop: () => {
      spy.mockRestore();
      return count;
    },
  };
}

/** `files` run and flushed by a keeper of `at`'s worktree; `onBusy` runs at the busy note. */
async function kept(
  at: Served,
  notes: string[],
  options: {
    readonly busyBoundMs?: number;
    readonly files?: readonly (readonly [TestFileRef, CheckKey])[];
    readonly onBusy?: (moved: ReturnType<typeof inputs>) => void;
  } = {},
): Promise<void> {
  const { busyBoundMs = 5_000, files = [[A, KEY_A]], onBusy = () => {} } = options;
  const moving = inputs();
  const keep = new Keeper({
    root: at.root,
    commonDir: at.commonDir,
    policy: POLICY,
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

function resultsAt(commonDir: string, key: CheckKey = KEY_A): number {
  const db = new DatabaseSync(storePaths(commonDir).database, { readOnly: true });
  try {
    return Number(db.prepare("SELECT count(*) AS n FROM results WHERE key = ?").get(key)?.n);
  } finally {
    db.close();
  }
}

function recordAt(commonDir: AbsolutePath, key: CheckKey = KEY_A): unknown {
  const code = openCodeStore(commonDir, POLICY, { create: false });
  if (isCodeStoreOpenFailure(code)) return null;
  try {
    const bytes = code.coverage.get({ resultKey: key, providerVersion: COVERAGE_RECORD_VERSION });
    return bytes === null ? null : decodeRecord(bytes);
  } finally {
    code.close();
  }
}

describe("the keeper while a daemon serves the worktree (021 D15, row 021-20)", () => {
  it("keeps each file through the daemon, with no write transaction of the gate's own", async () => {
    const at = await served();
    const notes: string[] = [];
    const count = countGateWrites();
    await kept(at, notes, { files: BOTH });
    expect(count.stop()).toBe(0);
    expect(notes).toEqual([]);
    expect([resultsAt(at.commonDir, KEY_A), resultsAt(at.commonDir, KEY_B)]).toEqual([1, 1]);
    expect(recordAt(at.commonDir)).toEqual(RECORD);
    expect(at.keeps.map((k) => k.write.kind)).toEqual([
      "coverage",
      "results",
      "coverage",
      "results",
    ]);
  });

  it("keeps the file once the lock is freed within the bound, and names the holder first", async () => {
    const at = await served();
    const notes: string[] = [];
    const locked = at.hold();
    const freed = setTimeout(locked.release, 400);
    const count = countGateWrites();
    try {
      await kept(at, notes);
    } finally {
      clearTimeout(freed);
      locked.release();
    }
    expect(count.stop()).toBe(0);
    expect(notes).toHaveLength(2);
    expect(notes[0]).toBe(
      `the store is busy (${locked.holder}); waiting up to 5 s to keep 1 completed test file: test/a.test.ts`,
    );
    expect(notes[1]).toMatch(/^the store was free after \d+(\.\d)? s: 1 completed test file kept$/);
    expect(resultsAt(at.commonDir)).toBe(1);
    expect(at.keeps.filter((k) => k.write.kind === "results").length).toBeGreaterThan(1);
  });

  it("keeps nothing while the lock outlasts the bound, and says who held it", async () => {
    const at = await served();
    const notes: string[] = [];
    const locked = at.hold();
    try {
      await kept(at, notes, { busyBoundMs: 600 });
    } finally {
      locked.release();
    }
    expect(notes).toEqual([
      `the store is busy (${locked.holder}); waiting up to 0.6 s to keep 1 completed test file: test/a.test.ts`,
      `1 completed test file was not kept in the stores: the store stayed busy for 0.6 s (${locked.holder}); the next run will run it again`,
    ]);
    expect(resultsAt(at.commonDir)).toBe(0);
  });

  it("does not keep a file whose input moved during the wait (review 0.1.444 B2)", async () => {
    const at = await served();
    const notes: string[] = [];
    const locked = at.hold();
    try {
      await kept(at, notes, {
        files: BOTH,
        onBusy: ({ move }) => {
          move(A);
          locked.release();
        },
      });
    } finally {
      locked.release();
    }
    expect(notes[1]).toMatch(
      /^the store was free after \d+(\.\d)? s: 1 completed test file kept; 1 changed during the wait, so the next run will run it again$/,
    );
    expect([resultsAt(at.commonDir, KEY_A), resultsAt(at.commonDir, KEY_B)]).toEqual([0, 1]);
  });

  it("keeps nothing, with the note before this row, when the daemon's heartbeat is late", async () => {
    const at = await served();
    const store = openStore(at.commonDir);
    if (isStoreOpenFailure(store)) throw new Error(store.reason);
    const worktreeId = worktreeIdFor(at.root);
    const record = store.worktrees.get(worktreeId)?.daemon;
    if (record == null) throw new Error("no daemon record");
    store.worktrees.setDaemon(worktreeId, {
      ...record,
      heartbeatAt: 1,
      heartbeatIntervalMs: 5_000,
    });
    store.close();
    const notes: string[] = [];
    await kept(at, notes);
    expect(notes).toEqual([
      "1 completed test file was not kept in the stores: a daemon runs in this worktree, and it keeps its own",
    ]);
    expect(at.keeps).toEqual([]);
    expect(resultsAt(at.commonDir)).toBe(0);
  });

  it("keeps nothing, with the note before this row, when the daemon takes no kept files", async () => {
    const at = await served(false);
    const notes: string[] = [];
    await kept(at, notes);
    expect(notes).toEqual([
      "1 completed test file was not kept in the stores: a daemon runs in this worktree, and it keeps its own",
    ]);
    expect(resultsAt(at.commonDir)).toBe(0);
  });
});
