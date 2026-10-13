import { afterEach, describe, expect, it } from "vitest";
import { startDaemon } from "../../src/core/daemon/daemon.js";
import { acquireDaemonLock } from "../../src/core/daemon/lock.js";
import { squealVersion } from "../../src/core/daemon/version.js";
import { lockFileFor, openStore } from "../../src/core/store/index.js";
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
afterEach(() => {
  for (const repo of repos.splice(0)) repo.cleanup();
});

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
    setTimeout(() => holder.release(), 300);
    const result = await startDaemon({ root: repo.root, env: repo.env, awaitLockMs: 5_000 });
    holder.release();
    if (!("reason" in result)) await result.stop("stop-requested");
    expect(result).toMatchObject({ reason: "lost-lock", code: 0 });
    expect(readNotes(repo)).toEqual([]);
  });
});
