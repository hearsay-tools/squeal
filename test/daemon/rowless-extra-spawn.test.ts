import { afterEach, describe, expect, it } from "vitest";
import { acquireDaemonLock, type DaemonLock } from "../../src/core/daemon/lock.js";
import { openDaemon } from "../../src/core/daemon/open.js";
import { markStart } from "../../src/core/presence/lock-events.js";
import { openStore } from "../../src/core/store/open.js";
import { lockFileFor } from "../../src/core/store/paths.js";
import type { AbsolutePath, WorktreeId } from "../../src/core/types/common.js";
import { createFixtureRepo, type FixtureRepo, readNotes } from "./helpers.js";

/*
 * Row 005-108 (the coordinator's condition 2): before the spawn guard read the
 * lock of a worktree with no row, every hook boundary during one slow start
 * spawned one more daemon. What each extra does, with its wait bounded at
 * 300 ms here for `VACANT_LOCK_WAIT_MS` (30 s): it loses the lock to the
 * starting daemon, polls it, and exits either at once once that daemon
 * registers, or at its bound with a note that the next boundary starts one.
 */

const repos: FixtureRepo[] = [];
const locks: DaemonLock[] = [];
afterEach(() => {
  for (const lock of locks.splice(0)) lock.release();
  for (const repo of repos.splice(0)) repo.cleanup();
});

/** A new worktree beside a store: no row for it, and its first daemon in its start, lock held and marked. */
function startingNoRow() {
  const repo = createFixtureRepo();
  repos.push(repo);
  const store = openStore(repo.commonDir as AbsolutePath);
  if ("reason" in store) throw new Error("no store");
  const id = repo.worktreeId as WorktreeId;
  expect(store.worktrees.get(id)).toBeNull();
  const lockFile = lockFileFor(repo.commonDir as AbsolutePath, id);
  const taken = acquireDaemonLock(lockFile);
  if (taken === null) throw new Error("the lock is taken");
  locks.push(markStart(lockFile, taken));
  return { repo, store, id };
}

describe("an extra daemon spawned during a row-less worktree's slow start (row 005-108)", () => {
  it("waits its bound for the lock, then exits with a note that the next boundary starts one", async () => {
    const { repo, store } = startingNoRow();
    store.close();

    const result = await openDaemon(repo.root, Date.now, undefined, 300);

    expect(result).toMatchObject({ reason: "lock-wait-timed-out", code: 0 });
    expect(readNotes(repo)).toEqual([
      "a daemon gave up: the lock was still held after 300 ms with no daemon serving; the next hook boundary starts one",
    ]);
  });

  it("exits with no note once the starting daemon registers within its bound", async () => {
    const { repo, store, id } = startingNoRow();
    setTimeout(() => {
      store.worktrees.upsert({
        id,
        root: repo.root as AbsolutePath,
        commonDir: repo.commonDir as AbsolutePath,
        isMain: true,
        registeredAt: Date.now(),
        daemon: {
          socketPath: repo.socketPath as AbsolutePath,
          startedAt: Date.now(),
          heartbeatAt: Date.now(),
          heartbeatIntervalMs: 5_000,
          squealVersion: "0.0.0-test",
        },
      });
      store.close();
    }, 50);

    const result = await openDaemon(repo.root, Date.now, undefined, 5_000);

    expect(result).toMatchObject({ reason: "lost-lock" });
    expect(readNotes(repo)).toEqual([]);
  });
});
