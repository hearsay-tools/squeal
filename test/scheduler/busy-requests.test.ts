import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { BusyWaits } from "../../src/core/store/busy.js";
import { setBusyTimeout } from "../../src/core/store/open.js";
import { storePaths } from "../../src/core/store/paths.js";
import type { RunnerAdapter } from "../../src/core/types/runner.js";
import { longestGap, threadLockHolder } from "../helpers/busy-store.js";
import { SLOW } from "./cleanup.js";
import { createRepo, openRepoStore } from "./repo.js";
import { openHarness } from "./vitest-harness.js";

/*
 * Review 0.1.434, B2 (spec 021 D2, row 021-08): a socket request's write
 * waited the store's one busy timeout and, refused, failed the request.
 * Each request's stage now takes the store's transaction before it changes
 * anything, so a refused stage is tried again whole and runs once. Row
 * 011-322: every request takes that retry in the request intake, whose
 * table (`request-intake.test.ts`) holds the per-request race; here stays
 * the runner retry's, whose keys are written outside the stage.
 */

/** The store's own wait: the daemon's 5 s, shorter than the hold. */
const OWN_MS = 100;
/** The daemon's `BUSY_SLICE_MS`, short. */
const SLICE_MS = 25;
/** The re-review's hold: past several slices and the store's own wait. */
const RETRY_HOLD_MS = 500;
/** The longest the event loop may stop while the runner retry waits: a slice, a backoff, and load. */
const RETRY_GAP_MS = 400;

/** How many `run --all` checkpoints the store holds for `worktreeId`, read by a connection of its own. */
function runAlls(database: string, worktreeId: string): number {
  const db = new DatabaseSync(database, { readOnly: true });
  try {
    const row = db
      .prepare("SELECT COUNT(*) AS n FROM checkpoints WHERE worktree_id = ? AND kind = 'run-all'")
      .get(worktreeId) as { n: number };
    return row.n;
  } finally {
    db.close();
  }
}

describe("a socket request's write on a busy store (review 0.1.434 B2)", SLOW, () => {
  /*
   * Re-review of 0.1.434, B2: with a runner failure outstanding, run --all
   * first asks the runner again, then stores what it said. Another thread
   * takes the write lock once the runner's environment is read, and lets go
   * on its own clock: the request waits a slice per try, the event loop
   * running between, and queues one checkpoint once the holder ends.
   */
  it("takes a squeal run --all whose runner retry meets the lock, with one checkpoint", async () => {
    const { main, commonDir } = createRepo();
    const store = openRepoStore(commonDir);
    const busyWaits = new BusyWaits({ now: Date.now, note: () => {} });
    const h = await openHarness(main, store, commonDir, {
      failing: ["environment"],
      allowErrors: true,
      busyWaits,
      busySliceMs: SLICE_MS,
    });
    await h.scheduler.start();
    await h.scheduler.idle();
    const database = storePaths(commonDir).database;
    const before = runAlls(database, h.worktreeId);
    const errors = h.errors.length;

    h.runner.failing.clear();
    const holder = threadLockHolder(database, RETRY_HOLD_MS);
    const runner = h.runner as { environment: RunnerAdapter["environment"] };
    const environment = runner.environment;
    runner.environment = async () => {
      const read = await environment();
      if (!holder.taken) holder.take();
      return read;
    };
    setBusyTimeout(store, OWN_MS);
    try {
      const request = h.scheduler.requestFullSuite();
      const gap = await longestGap(request);
      const checkpoint = await request;

      expect(holder.taken).toBe(true);
      expect(holder.released).toBe(true);
      expect(store.checkpoints.get(checkpoint.id)).toMatchObject({ kind: "run-all" });
      expect(runAlls(database, h.worktreeId)).toBe(before + 1);
      expect(gap).toBeLessThan(RETRY_GAP_MS);
      expect(h.errors.slice(errors)).toEqual([]);
    } finally {
      runner.environment = environment;
      setBusyTimeout(store, 10_000);
    }
  });
});
