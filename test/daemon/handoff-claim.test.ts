import { afterEach, describe, expect, it } from "vitest";
import { startDaemon } from "../../src/core/daemon/daemon.js";
import { acquireDaemonLock } from "../../src/core/daemon/lock.js";
import { openDaemon } from "../../src/core/daemon/open.js";
import { claimHandoff, readHandoff } from "../../src/core/delivery/handoff.js";
import { isStoreOpenFailure, lockFileFor, openStore } from "../../src/core/store/index.js";
import type { AbsolutePath, EpochMs, WorktreeId } from "../../src/core/types/index.js";
import { createFixtureRepo, type FixtureRepo, readNotes, withStore } from "./helpers.js";

/*
 * Row 011-32 (011 C9 as amended 2026-10-20): the handoff claim ends when its
 * successor registers, in the registering transaction, and when that
 * successor's lock wait ends without the lock, in its note's write, so the
 * next boundary claims again. A vacant-lock waiter is no claimed successor:
 * its wait leaves the claim.
 */

const repos: FixtureRepo[] = [];
afterEach(() => {
  for (const repo of repos.splice(0)) repo.cleanup();
});

function fixture(): FixtureRepo {
  const repo = createFixtureRepo();
  repos.push(repo);
  return repo;
}

const id = (repo: FixtureRepo) => repo.worktreeId as WorktreeId;

/** A live claim of a handoff from an older daemon, in a store created for it. */
function claimed(repo: FixtureRepo): void {
  const store = openStore(repo.commonDir as AbsolutePath);
  if (isStoreOpenFailure(store)) throw new Error("no store");
  try {
    const claim = { from: "0.1.0@1#t", to: "0.1.31", at: Date.now() as EpochMs };
    expect(claimHandoff(store, id(repo), claim)).not.toBeNull();
  } finally {
    store.close();
  }
}

const claim = (repo: FixtureRepo) => withStore(repo, (store) => readHandoff(store, id(repo)));

/** Holds the worktree's daemon lock, as a stepping daemon does until it exits. */
function lockHeld(repo: FixtureRepo): () => void {
  const path = lockFileFor(repo.commonDir as AbsolutePath, id(repo));
  const holder = acquireDaemonLock(path);
  if (holder === null) throw new Error("the lock is taken");
  return () => holder.release();
}

describe("the end of a handoff claim (row 011-32)", () => {
  it("goes when a daemon registers", async () => {
    const repo = fixture();
    claimed(repo);
    const daemon = await startDaemon({ root: repo.root, env: repo.env });
    if ("reason" in daemon) throw new Error(`exited: ${daemon.message}`);
    try {
      expect(claim(repo)).toBeNull();
    } finally {
      await daemon.stop("stop-requested");
    }
  });

  it("goes with the note of a successor whose lock wait ran out", async () => {
    const repo = fixture();
    claimed(repo);
    const release = lockHeld(repo);
    try {
      const exit = await openDaemon(repo.root, () => Date.now() as EpochMs, 200);
      expect(exit).toMatchObject({ reason: "lock-wait-timed-out", code: 0 });
    } finally {
      release();
    }
    expect(claim(repo)).toBeNull();
    expect(readNotes(repo)).toEqual([
      expect.stringMatching(/successor daemon gave up: the lock was still held after 200 ms/),
    ]);
  });

  it("stays when a vacant-lock wait runs out: that waiter was no claimed successor", async () => {
    const repo = fixture();
    claimed(repo);
    const release = lockHeld(repo);
    try {
      const exit = await openDaemon(repo.root, () => Date.now() as EpochMs, undefined, 200);
      expect(exit).toMatchObject({ reason: "lock-wait-timed-out", code: 0 });
    } finally {
      release();
    }
    expect(claim(repo)).toMatchObject({ to: "0.1.31" });
    expect(readNotes(repo)).toEqual([expect.stringMatching(/a daemon gave up/)]);
  });
});
