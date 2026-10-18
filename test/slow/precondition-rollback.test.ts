import { rmSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { setBusyTimeout, storePaths } from "../../src/core/store/index.js";
import { connectionOf } from "../../src/core/store/store.js";
import type { Harness } from "../scheduler/helpers.js";
import { SLOW } from "../scheduler/helpers.js";
import { waitFor } from "../watcher/helpers.js";
import {
  forcedSkip,
  READY,
  ranThenUnready,
  reopen,
  SLOW_FILES,
  skipReason,
  slowRuns,
  UPPER,
} from "./precondition-helpers.js";

/*
 * Review wave-8.1, fourth round: a skip, lift or requeue whose store
 * transaction fails leaves the scheduler's skips, queue and open checkpoint
 * as the store has them. R1: a requeue whose BEGIN meets another writer
 * keeps the skip, so the retry checks the precondition again rather than
 * certify a full suite over it. R2: a skip rolled back after its checkpoint
 * ended keeps that checkpoint open in the tracker, so a retry or a restart
 * still ends it, abandoned.
 */

const commonDir = (h: Harness) => {
  const dir = h.store.worktrees.get(h.worktreeId)?.commonDir;
  if (dir === undefined) throw new Error("the harness registered no worktree");
  return dir;
};

/** Holds the store's write lock from a second connection until the returned release. */
function holdWriteLock(h: Harness): () => void {
  const db = new DatabaseSync(storePaths(commonDir(h)).database);
  db.exec("BEGIN IMMEDIATE");
  return () => {
    db.exec("ROLLBACK");
    db.close();
  };
}

/** A real SQLite error on the writer's connection when the sink writes a skipped check stale. */
function failStaleWrites(h: Harness): () => void {
  const { db } = connectionOf(h.store);
  db.exec(`CREATE TEMP TRIGGER review_sink_error BEFORE INSERT ON known_states
    WHEN NEW.validity = 'stale'
    BEGIN SELECT RAISE(ABORT, 'review injected SQLite sink error'); END`);
  return () => db.exec("DROP TRIGGER review_sink_error");
}

/**
 * Makes the next store transaction whose stack names `within` throw a busy
 * store's error; the returned function tells whether it did.
 */
function failNextWrite(h: Harness, within: string): () => boolean {
  const store = h.store;
  const transaction = store.transaction.bind(store);
  let fired = false;
  store.transaction = ((fn: () => unknown) => {
    if (!new Error().stack?.includes(within)) return transaction(fn);
    store.transaction = transaction;
    fired = true;
    throw Object.assign(new Error("database is locked"), { errcode: 5 });
  }) as typeof store.transaction;
  return () => fired;
}

describe("a skip transaction that fails (review wave-8.1, fourth round)", SLOW, () => {
  it("R1: keeps the skip through a busy requeue, so the retry checks it again", async () => {
    const h = await ranThenUnready();
    await forcedSkip(h);
    expect(skipReason(h)).toBe(READY);

    const release = holdWriteLock(h);
    setBusyTimeout(h.store, 25);
    try {
      await expect(h.scheduler.requestFullSuite()).rejects.toThrow(/locked/);
    } finally {
      release();
      setBusyTimeout(h.store, 10_000);
    }
    expect(skipReason(h)).toBe(READY);

    const retry = await h.scheduler.requestFullSuite();
    expect(retry.testFiles.map((ref) => ref.path).sort()).toEqual(SLOW_FILES);
    await h.scheduler.idle();
    expect(h.store.checkpoints.get(retry.id)?.end).toBe("abandoned");
    expect(h.header().fullSuite.atCurrentRevision).toBe(false);
    expect(h.header().slowTier).toMatchObject({ current: 0, notRun: 2, skipped: READY });
  });

  it("R1: keeps the skip a revision's requeue could not commit, so run --all checks it again", async () => {
    const h = await ranThenUnready(undefined, { allowErrors: true });
    await forcedSkip(h);
    // A revision that may change what the rule reads makes both files eligible: their requeue fails.
    h.write("ready", "");
    const failed = failNextWrite(h, "revised");
    await h.batch("ready").catch(() => undefined);
    await h.scheduler.idle();
    expect(failed()).toBe(true);
    expect(skipReason(h)).toBe(READY);

    rmSync(join(h.root, "ready"));
    const retry = await h.scheduler.requestFullSuite();
    expect(retry.testFiles.map((ref) => ref.path).sort()).toEqual(SLOW_FILES);
    await h.scheduler.idle();
    expect(h.store.checkpoints.get(retry.id)?.end).toBe("abandoned");
    expect(h.header().fullSuite.atCurrentRevision).toBe(false);
  });

  it("keeps a skip whose lift could not commit, so the next check lifts it", async () => {
    const h = await ranThenUnready(undefined, { allowErrors: true });
    await forcedSkip(h);
    // Met by a path no revision names; an edit to one skipped file queues it, and its check lifts the skip.
    h.write("ready", "");
    const edit = (n: number) =>
      h.write(
        UPPER,
        `import { expect, it } from "vitest";\nit("edited", () => expect(${n}).toBe(${n}));\n`,
      );
    edit(1);
    const failed = failNextWrite(h, "#lift");
    await h.batch(UPPER);
    await waitFor(failed, 60_000);
    await h.scheduler.idle();
    expect(skipReason(h)).toBe(READY);

    edit(2);
    await h.batch(UPPER);
    await waitFor(() => slowRuns(h, [UPPER]).length === 2, 60_000);
    await h.scheduler.idle();
    expect(skipReason(h)).toBeNull();
  });

  it("R2: ends the checkpoint a rolled-back skip had ended, at the retry", async () => {
    const h = await ranThenUnready(undefined, { allowErrors: true });
    const restore = failStaleWrites(h);
    const first = await h.scheduler.requestFullSuite({ force: true });
    await h.scheduler.idle();
    expect(h.errors.map(String).join("\n")).toContain("review injected SQLite sink error");
    expect(h.store.checkpoints.get(first.id)?.end).toBeNull();
    expect(skipReason(h)).toBeNull();
    restore();

    const retry = await h.scheduler.requestFullSuite();
    await h.scheduler.idle();
    expect(h.store.checkpoints.get(first.id)?.end).toBe("abandoned");
    expect(h.store.checkpoints.get(retry.id)?.end).toBe("abandoned");
    expect(skipReason(h)).toBe(READY);
    expect(h.header().fullSuite.atCurrentRevision).toBe(false);
    await h.scheduler.close();
    expect(h.store.checkpoints.get(first.id)?.end).toBe("abandoned");
  });

  it("R2: owes the checkpoint a rolled-back skip had ended at close, and the next daemon ends it", async () => {
    const h = await ranThenUnready(undefined, { allowErrors: true });
    const restore = failStaleWrites(h);
    const first = await h.scheduler.requestFullSuite({ force: true });
    await h.scheduler.idle();
    expect(h.store.checkpoints.get(first.id)?.end).toBeNull();
    restore();

    // The tracker kept it open: the closing daemon owes it rather than leave it open unowned.
    await h.scheduler.close();
    expect(h.store.checkpoints.get(first.id)?.end).toBeNull();
    const next = await reopen(h, { exists: ["ready"] });
    expect(next.store.checkpoints.get(first.id)?.end).toBe("abandoned");
    expect(skipReason(next)).toBe(READY);
    expect(next.header().slowTier).toMatchObject({ current: 0, notRun: 2, skipped: READY });
  });
});
