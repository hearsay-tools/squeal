import { type ChildProcess, spawn } from "node:child_process";
import { subscribe, unsubscribe } from "node:diagnostics_channel";
import { afterEach, describe, expect, it } from "vitest";
import { startDaemon } from "../../src/core/daemon/daemon.js";
import { acquireDaemonLock, type DaemonLock } from "../../src/core/daemon/lock.js";
import { DAEMON_BUSY_TIMEOUT_MS, openDaemon } from "../../src/core/daemon/open.js";
import { squealVersion } from "../../src/core/daemon/version.js";
import { lockFileFor, openStore, storePaths } from "../../src/core/store/index.js";
import type { AbsolutePath, EpochMs, WorktreeId } from "../../src/core/types/index.js";
import { createFixtureRepo, type FixtureRepo, readNotes } from "./helpers.js";

/*
 * Review 001-347, B2: a daemon waiting for a lock it lost decides at each
 * check whether to give up, but takes the lock between checks. A waiter
 * descheduled across a newer daemon's registration and shutdown took the
 * freed lock and served the older version. Under the lock nothing can
 * register, so it reads the last recorded daemon once more there.
 */

const repos: FixtureRepo[] = [];
const blockers: ChildProcess[] = [];
const subscriptions: (() => void)[] = [];
afterEach(() => {
  for (const end of subscriptions.splice(0)) end();
  for (const blocker of blockers.splice(0)) blocker.kill("SIGKILL");
  for (const repo of repos.splice(0)) repo.cleanup();
});

/** `pauseAt`'s channel (`src/core/daemon/test-pause.ts`); a daemon this process starts publishes to it. */
const TEST_PAUSE_CHANNEL = "squeal:test-pause";

/**
 * Row 011-225: lets go of `holder` once a waiter in this process is in its
 * lock wait, after its first failed attempt and the check after it
 * (`pauseAt("lock-wait")`). A timer raced the waiter's start: one that
 * outlasted it found the lock free at its first attempt, never waited and
 * so never read again; it opened the busy store and served. Returns whether
 * the waiter waited, each case's premise.
 */
function releasedOnceWaiting(holder: DaemonLock): () => boolean {
  let waited = false;
  const onPause = (point: unknown) => {
    if (point !== "lock-wait") return;
    waited = true;
    holder.release();
  };
  subscribe(TEST_PAUSE_CHANNEL, onPause);
  subscriptions.push(() => unsubscribe(TEST_PAUSE_CHANNEL, onPause));
  return () => waited;
}

function lockFile(repo: FixtureRepo): AbsolutePath {
  return lockFileFor(repo.commonDir as AbsolutePath, repo.worktreeId as WorktreeId);
}

/** A daemon of `squealVersion` registers on the worktree, then its shutdown clears the record (D10). */
function registeredAndStopped(repo: FixtureRepo, squealVersion: string): void {
  const store = openStore(repo.commonDir as AbsolutePath);
  if ("reason" in store) throw new Error("no store");
  const id = repo.worktreeId as WorktreeId;
  store.worktrees.upsert({
    id,
    root: repo.root as AbsolutePath,
    commonDir: repo.commonDir as AbsolutePath,
    isMain: true,
    registeredAt: 1,
    daemon: {
      socketPath: repo.socketPath as AbsolutePath,
      startedAt: 7 as EpochMs,
      heartbeatAt: Date.now() as EpochMs,
      heartbeatIntervalMs: 5_000,
      squealVersion,
    },
  });
  store.worktrees.setDaemon(id, null);
  store.close();
}

/**
 * Starts a daemon while the lock is held by one still starting, before its
 * registration. At the waiter's first check, which finds no record, it is
 * as if descheduled: a daemon of `version` registers, stops and lets go of
 * the lock before the waiter's next attempt, which takes it.
 */
async function startAcrossRegistration(repo: FixtureRepo, version: string, awaitLockMs?: number) {
  const holder = acquireDaemonLock(lockFile(repo));
  if (holder === null) throw new Error("the lock is taken");
  let checked = false;
  const now = () => {
    if (!checked) {
      checked = true;
      setImmediate(() => {
        registeredAndStopped(repo, version);
        holder.release();
      });
    }
    return Date.now() as EpochMs;
  };
  try {
    return await startDaemon({
      root: repo.root,
      env: repo.env,
      now,
      ...(awaitLockMs === undefined ? {} : { awaitLockMs }),
    });
  } finally {
    holder.release();
  }
}

describe("a lock waiter decides again once it holds the lock (review 001-347, B2)", () => {
  it("a vacant-lock waiter exits as a loser, no note, when a newer daemon came and went", async () => {
    const repo = createFixtureRepo();
    repos.push(repo);
    const result = await startAcrossRegistration(repo, "999.0.0");
    if (!("reason" in result)) await result.stop("stop-requested");
    expect(result).toMatchObject({ reason: "lost-lock", code: 0 });
    expect(readNotes(repo)).toEqual([]);
    // It let go of the lock.
    const lock = acquireDaemonLock(lockFile(repo));
    expect(lock).not.toBeNull();
    lock?.release();
  });

  it("a vacant-lock waiter serves when a daemon of its own version came and went (accepted, D10)", async () => {
    const repo = createFixtureRepo();
    repos.push(repo);
    const result = await startAcrossRegistration(repo, squealVersion());
    if ("reason" in result) throw new Error(`exited: ${result.message}`);
    await result.stop("stop-requested");
  });

  it("a successor exits as a loser, no note, when the last recorded daemon is newer than itself", async () => {
    const repo = createFixtureRepo();
    repos.push(repo);
    // The successor's check reads only a socket-bearing record, never a cleared one.
    registeredAndStopped(repo, "999.0.0");
    const holder = acquireDaemonLock(lockFile(repo));
    if (holder === null) throw new Error("the lock is taken");
    const waited = releasedOnceWaiting(holder);
    const result = await startDaemon({ root: repo.root, env: repo.env, awaitLockMs: 5_000 });
    holder.release();
    if (!("reason" in result)) await result.stop("stop-requested");
    expect(waited(), "the successor waited for the lock").toBe(true);
    expect(result).toMatchObject({ reason: "lost-lock", code: 0 });
    expect(readNotes(repo)).toEqual([]);
  });
});

/**
 * Another process holds the store exclusively for `holdMs`, so no
 * connection can read it until then. Resolves once it holds it.
 */
async function storeHeld(repo: FixtureRepo, holdMs: number): Promise<void> {
  const code = `const { DatabaseSync } = await import("node:sqlite");
const db = new DatabaseSync(process.argv[1]);
db.exec("PRAGMA busy_timeout = 1000; PRAGMA locking_mode = EXCLUSIVE; BEGIN EXCLUSIVE");
process.send("held");
setTimeout(() => { db.exec("ROLLBACK"); db.close(); process.disconnect(); }, ${holdMs});`;
  const database = storePaths(repo.commonDir as AbsolutePath).database;
  const blocker = spawn(
    process.execPath,
    ["--disable-warning=ExperimentalWarning", "--input-type=module", "-e", code, database],
    { stdio: ["ignore", "ignore", "pipe", "ipc"] },
  );
  blockers.push(blocker);
  let stderr = "";
  blocker.stderr?.on("data", (data) => {
    stderr += data;
  });
  await new Promise<void>((resolve, reject) => {
    blocker.once("message", () => resolve());
    blocker.once("exit", (code) => reject(new Error(`the store holder exited ${code}: ${stderr}`)));
  });
}

/*
 * Review 001-351, B1: the waiter's last-version read under the lock gave up
 * after its 5 s busy timeout and counted as no daemon recorded, while the
 * store open after it waits 2 minutes, so a store busy for longer than the
 * read and shorter than the open let an older waiter serve over a newer
 * recorded daemon. An unread version is unknown, never absent.
 */
describe("a lock waiter that cannot yet read the last recorded daemon (review 001-351, B1)", () => {
  const holdMs = DAEMON_BUSY_TIMEOUT_MS + 2_000;

  for (const mode of ["vacant", "--await-lock"] as const) {
    it(`a ${mode} waiter reads again and exits as a loser, no note, once the store is readable`, async () => {
      const repo = createFixtureRepo();
      repos.push(repo);
      registeredAndStopped(repo, "999.0.0");
      const holder = acquireDaemonLock(lockFile(repo));
      if (holder === null) throw new Error("the lock is taken");
      await storeHeld(repo, holdMs);
      const waited = releasedOnceWaiting(holder);
      const at = performance.now();
      const result = await startDaemon({
        root: repo.root,
        env: repo.env,
        ...(mode === "--await-lock" ? { awaitLockMs: 15_000 } : {}),
      });
      const elapsed = performance.now() - at;
      holder.release();
      if (!("reason" in result)) await result.stop("stop-requested");
      // The premise: it took the lock in its wait, and its first read under the lock found the store busy.
      expect(waited(), "the waiter waited for the lock").toBe(true);
      expect(elapsed).toBeGreaterThanOrEqual(DAEMON_BUSY_TIMEOUT_MS);
      expect(result).toMatchObject({ reason: "lost-lock", code: 0 });
      expect(readNotes(repo)).toEqual([]);
      const lock = acquireDaemonLock(lockFile(repo));
      expect(lock).not.toBeNull();
      lock?.release();
    }, 30_000);
  }

  it("a waiter that cannot decide within its budget lets go of the lock and exits with one note, code 0", async () => {
    const repo = createFixtureRepo();
    repos.push(repo);
    registeredAndStopped(repo, "999.0.0");
    const holder = acquireDaemonLock(lockFile(repo));
    if (holder === null) throw new Error("the lock is taken");
    await storeHeld(repo, 2_500);
    const waited = releasedOnceWaiting(holder);
    const now = () => Date.now() as EpochMs;
    const result = await openDaemon(repo.root, now, 15_000, undefined, 1_000);
    holder.release();
    if (!("reason" in result)) {
      result.lock.release();
      result.store.close();
    }
    expect(waited(), "the waiter waited for the lock").toBe(true);
    expect(result).toMatchObject({ reason: "lock-wait-timed-out", code: 0 });
    expect((result as { message: string }).message).toMatch(/could not read/);
    expect(readNotes(repo)).toHaveLength(1);
    const lock = acquireDaemonLock(lockFile(repo));
    expect(lock).not.toBeNull();
    lock?.release();
  }, 30_000);
});
