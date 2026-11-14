import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { codeStorePath } from "../../src/core/code/store/open.js";
import { noCodeRemoved, pruneCodeSlices } from "../../src/core/code/store/prune.js";
import { SlicedPrune } from "../../src/core/daemon/sliced-prune.js";
import { Connection } from "../../src/core/store/connection.js";
import { holdEvery, startWaiter, type Waiter } from "../store/write-turns-rig.js";
import { commonDir, count, open } from "./helpers.js";

/*
 * Row 011-350 (#220): every worktree's daemon writes to one code store. The
 * code prune deletes in batches of 256 rows; the daemon runs them through
 * `SlicedPrune`, which pauses after each for as long as it held the lock,
 * so a writer in another process lands between batches. Back to back, a
 * waiter with a 250 ms busy slice landed 0 times in 8 s
 * (`issue-220.md` Q1).
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = 100 * DAY_MS;
const BATCHES = 12;
/** How long each batch holds the lock: a batch of a large store. */
const HOLD_MS = 50;

const closing: (() => unknown)[] = [];
afterEach(async () => {
  for (const close of closing.splice(0).reverse()) await close();
});

describe("the code prune's turns (row 011-350)", () => {
  it("lets a waiting writer of another thread land between its delete batches", async () => {
    const dir = commonDir();
    const store = open(dir);
    const rows = BATCHES * 256 + 10;
    store.transaction(() => {
      for (let i = 0; i < rows; i++) store.counts.put(count(`old-${i}`), NOW - 30 * DAY_MS);
    });
    const waiter: Waiter = await startWaiter(codeStorePath(dir));
    closing.push(() => waiter.stop());
    const conn = new Connection(new DatabaseSync(codeStorePath(dir)));
    closing.push(() => conn.close());
    const holds = holdEvery(conn.db, "DELETE", "counts", 256, HOLD_MS, waiter.landed);
    const counts = noCodeRemoved();
    const logged: string[] = [];

    await new SlicedPrune({ log: (line) => logged.push(line) }).run(() =>
      pruneCodeSlices(conn, { now: NOW, retentionDays: 7, worktrees: [], consumers: [] }, counts),
    );

    expect(logged).toEqual([]);
    expect(counts.countsRemoved).toBe(rows);
    expect(holds.count).toBe(BATCHES);
    // The waiter wrote while the prune still had batches to run.
    expect(holds.last - holds.first).toBeGreaterThan(0);
  });
});
