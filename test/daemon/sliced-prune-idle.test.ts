import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SlicedPrune } from "../../src/core/daemon/sliced-prune.js";
import { observeWrites } from "../../src/core/store/connection.js";
import { storePaths } from "../../src/core/store/paths.js";
import { noneRemoved, type PruneSlice, pruneSlices } from "../../src/core/store/prune.js";
import { connectionOf } from "../../src/core/store/store.js";
import type { Store } from "../../src/core/types/store.js";
import {
  DAY_MS,
  fakeCommonDir,
  knownState,
  open,
  result,
  tempDir,
  testCheck,
  worktree,
} from "../store/helpers.js";

/*
 * Row 025-10 (spec 025 D10, item 4): a prune slice that wrote nothing takes
 * no pause after it, and a prune of a store with nothing to prune takes no
 * write lock at all, so an idle daemon's prune neither holds the lock nor
 * stalls.
 */

const NOW = 100 * DAY_MS;

afterEach(() => observeWrites(null));

/** Counts every write transaction this thread begins. */
function countWrites(): { n: number } {
  const seen = { n: 0 };
  observeWrites(() => {
    seen.n++;
    return null;
  });
  return seen;
}

/** A store with one live worktree, its states and their current results: nothing to prune. */
function settled(): { commonDir: string; store: Store } {
  const commonDir = fakeCommonDir();
  const store = open(commonDir);
  const root = tempDir();
  mkdirSync(join(root, ".git"));
  store.worktrees.upsert(worktree("live", root, { commonDir }));
  const checks = Array.from({ length: 20 }, (_, i) => testCheck(`t${i}`));
  store.knownStates.upsertMany(checks.map((check) => knownState("live", check)));
  store.results.putMany(checks.map((check, i) => result(check, `k${i}`, { recordedAt: NOW })));
  return { commonDir, store };
}

function slicesOf(commonDir: string, store: Store, counts = noneRemoved()) {
  return () =>
    pruneSlices(
      connectionOf(store),
      store.worktrees,
      storePaths(commonDir),
      { now: NOW, retentionDays: 7, maxSizeMb: null },
      counts,
    );
}

describe("zero-row prune slices (row 025-10)", () => {
  it("pauses only after a slice that wrote, or did not say", async () => {
    const pauses: number[] = [];
    const ran: string[] = [];
    const slice =
      (name: string, wrote: boolean | undefined): PruneSlice =>
      () => {
        ran.push(name);
        return wrote;
      };
    await new SlicedPrune({
      log: () => {},
      pause: async (ms) => {
        pauses.push(ms);
      },
    }).run(() => [
      slice("read", false),
      slice("delete", true),
      slice("kept every row", false),
      slice("legacy", undefined),
    ]);
    expect(ran).toEqual(["read", "delete", "kept every row", "legacy"]);
    expect(pauses).toHaveLength(2);
  });

  it("takes no write lock and no pause on a store with nothing to prune", async () => {
    const { commonDir, store } = settled();
    const pauses: number[] = [];
    const writes = countWrites();
    const counts = noneRemoved();
    let ended = false;
    await new SlicedPrune({
      log: () => {},
      pause: async (ms) => {
        pauses.push(ms);
      },
    }).run(slicesOf(commonDir, store, counts), () => {
      ended = true;
    });
    expect(ended).toBe(true);
    expect(writes.n).toBe(0);
    expect(pauses).toEqual([]);
    expect(counts).toEqual(noneRemoved());
  });

  it("still writes, and pauses, when a slice has rows to delete", async () => {
    const { commonDir, store } = settled();
    store.results.putMany([
      result(testCheck("old"), "gone-key", { worktreeId: "gone", recordedAt: DAY_MS }),
    ]);
    const pauses: number[] = [];
    const writes = countWrites();
    const counts = noneRemoved();
    await new SlicedPrune({
      log: () => {},
      pause: async (ms) => {
        pauses.push(ms);
      },
    }).run(slicesOf(commonDir, store, counts));
    expect(counts.resultsRemoved).toBe(1);
    expect(writes.n).toBeGreaterThan(0);
    expect(pauses.length).toBeGreaterThan(0);
  });
});
