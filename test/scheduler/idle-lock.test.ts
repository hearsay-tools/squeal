import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { setBusyTimeout, storePaths } from "../../src/core/store/index.js";
import { createRepo, openHarness, openRepoStore, SLOW } from "./helpers.js";

/*
 * Task 001-412: cezar's idle daemons logged "daemon error: database is
 * locked" while another daemon of the shared store held its write lock past
 * their 5 s busy timeout. The bare note is the change feed's: a reconciliation
 * pass that threw from `handleBatch`. Every 30 s pass took the write lock
 * twice (the held files' take, the stat cache's flush) with nothing to write;
 * a pass that finds nothing takes no write lock.
 */

const BUSY_MS = 50;

/** Holds the store's write lock from a second connection until the returned release. */
function holdWriteLock(commonDir: string): () => void {
  const db = new DatabaseSync(storePaths(commonDir).database);
  db.exec("BEGIN IMMEDIATE");
  return () => {
    db.exec("COMMIT");
    db.close();
  };
}

describe("an idle daemon's reconciliation pass on a busy store (001-412)", () => {
  it(
    "takes no write lock when nothing changed, and records the edit once the lock is free",
    SLOW,
    async () => {
      const { main, commonDir } = createRepo();
      const store = openRepoStore(commonDir);
      const h = await openHarness(main, store, commonDir);
      await h.scheduler.start();
      await h.scheduler.idle();
      await h.scheduler.handleBatch({ trigger: "interval", paths: [] });
      await h.scheduler.idle();
      const before = store.revisions.latest(h.worktreeId)?.number ?? 0;
      setBusyTimeout(store, BUSY_MS);

      const release = holdWriteLock(commonDir);
      try {
        await h.scheduler.handleBatch({ trigger: "interval", paths: [] });
        await h.scheduler.idle();
      } finally {
        release();
      }
      expect(store.revisions.latest(h.worktreeId)?.number ?? 0).toBe(before);

      h.write("src/math.ts", "export const add = (a: number, b: number) => b + a;\n");
      await h.batch("src/math.ts");
      await h.scheduler.idle();
      expect(store.revisions.latest(h.worktreeId)?.number).toBe(before + 1);
    },
  );
});
