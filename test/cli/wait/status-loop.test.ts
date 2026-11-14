import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import type { DaemonSync } from "../../../src/cli/status-sync.js";
import { waitForStatus } from "../../../src/cli/status-wait.js";
import { waitForNamed } from "../../../src/cli/status-wait-paths.js";
import { storePaths } from "../../../src/core/store/paths.js";
import { A, finish, NOW, repoWith } from "../status-wait-fixture.js";

/*
 * Row 011-331: the status waits' loop rows for the store rules of their
 * rows (`STATUS_WAITS`, the store rules), over a real store and a second
 * connection's exclusive lock, in real time: a read that cannot read the
 * store ends the wait at the first read and at the deadline's, the latter
 * after the full busy timeout (`readBound`); one between them is skipped
 * and the next read decides. Each read's busy timeout is at most 1 s, so a
 * lock held 1.3 s fails at least one read.
 */

const locks: DatabaseSync[] = [];
afterEach(() => {
  for (const db of locks.splice(0)) db.close();
});

/**
 * Takes the worktree's store with an exclusive lock, released after `holdMs`
 * (or at the test's end); the fixture's own connection is closed first.
 */
function lockStore(commonDir: string, holdMs?: number): void {
  const db = new DatabaseSync(storePaths(commonDir as never).database);
  db.exec("PRAGMA locking_mode = EXCLUSIVE; BEGIN EXCLUSIVE");
  db.prepare("SELECT count(*) FROM sqlite_schema").get();
  locks.push(db);
  if (holdMs === undefined) return;
  setTimeout(() => {
    const at = locks.indexOf(db);
    if (at !== -1) locks.splice(at, 1);
    db.close();
  }, holdMs);
}

/**
 * A daemon that cannot sync (the settle time 0 decides), whose sync is
 * asked at the wait's first read; `then`, run once that read's transaction
 * closed.
 */
function syncThen(then: () => void) {
  return (): DaemonSync => {
    setTimeout(then, 0);
    return { current: () => ({ state: "unsupported" }), stop: () => {} };
  };
}

type Fixture = ReturnType<typeof repoWith>;

/** A worktree with A pending, and its edit and named waits, `then` run after their first read. */
function waits(then: (w: Fixture) => void) {
  const w = repoWith([A]);
  const { repo } = w;
  const sync = syncThen(() => then(w));
  const edit = (timeoutMs: number) =>
    waitForStatus(repo.main as never, { timeoutMs, pollMs: 20, settleMs: 0, now: () => NOW, sync });
  const named = (timeoutMs: number) =>
    waitForNamed(repo.main as never, [A], {
      timeoutMs,
      pollMs: 20,
      settleMs: 0,
      now: () => NOW,
      sync,
      promote: () => {},
    });
  return { ...w, edit, named };
}

describe.each(["edit", "named"] as const)("the %s wait's store rules (row 011-331)", (form) => {
  it("unavailable: a first read that cannot read the store ends the wait at once", async () => {
    const w = waits(() => {});
    w.store.close();
    lockStore(w.repo.commonDir);
    const wait = await (form === "edit" ? w.edit(5_000) : w.named(5_000));
    expect(wait.outcome).toBe("unavailable");
    expect(wait.result).toMatchObject({ available: false, reason: "timeout" });
    expect(wait.waitedMs).toBeLessThan(3_000);
  });

  it("go on: a later read that cannot read the store is skipped, and the next read decides", async () => {
    // After the first read: A gets its result, then the lock outlasts one read's busy timeout.
    const w = waits(({ repo, store }) => {
      finish(store, repo.mainId, A);
      store.close();
      lockStore(repo.commonDir, 1_300);
    });
    const wait = await (form === "edit" ? w.edit(10_000) : w.named(10_000));
    expect(wait.outcome).toBe(form === "edit" ? "quiet" : "settled");
    expect(wait.waitedMs).toBeGreaterThanOrEqual(1_000);
  });

  it("unavailable: the deadline's read that cannot read the store ends it, after the full busy timeout", async () => {
    const w = waits(({ repo, store }) => {
      store.close();
      lockStore(repo.commonDir);
    });
    const wait = await (form === "edit" ? w.edit(300) : w.named(300));
    expect(wait.outcome).toBe("unavailable");
    expect(wait.result).toMatchObject({
      reason: "timeout",
      message: expect.stringMatching(/^status unavailable, store busy, waited \d+ ms/),
    });
    // The read before the deadline waited what was left; the deadline's read, the full 1 s.
    expect(wait.waitedMs).toBeGreaterThanOrEqual(300 + 900);
  });
});
