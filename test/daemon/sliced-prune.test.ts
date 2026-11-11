import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PRUNE_GAP_MS, SlicedPrune } from "../../src/core/daemon/sliced-prune.js";
import { BusyWaits } from "../../src/core/store/busy.js";
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
 * Spec 021 D3 (row 021-09): the daemon prunes in slices, one write
 * transaction each, with the store's write lock free and the event loop
 * running for `PRUNE_GAP_MS` between them.
 */

const NOW = 100 * DAY_MS;

/** Tries the store's write lock every 10 ms from another connection, never waiting. */
function probe(commonDir: string) {
  const db = connectionOf(open(commonDir)).db;
  db.exec("PRAGMA busy_timeout = 0");
  const seen = { free: 0, busy: 0 };
  const timer = setInterval(() => {
    try {
      db.exec("BEGIN IMMEDIATE");
      db.exec("ROLLBACK");
      seen.free++;
    } catch {
      seen.busy++;
    }
  }, 10);
  return { seen, stop: () => clearInterval(timer) };
}

/** A removed worktree with 600 known states, and 600 results no rule keeps. */
function prunable(): { commonDir: string; store: Store } {
  const commonDir = fakeCommonDir();
  const store = open(commonDir);
  const root = tempDir();
  writeFileSync(join(root, ".git"), `gitdir: ${commonDir}/worktrees/removed\n`);
  store.worktrees.upsert(worktree("removed", root, { commonDir }));
  rmSync(root, { recursive: true });
  const n = Array.from({ length: 600 }, (_, i) => i);
  store.knownStates.upsertMany(n.map((i) => knownState("removed", testCheck(`s${i}`))));
  store.results.putMany(
    n.map((i) => result(testCheck(`r${i}`), `k${i}`, { worktreeId: "gone", recordedAt: DAY_MS })),
  );
  return { commonDir, store };
}

/** A slice that holds the write lock `ms`, sleeping, and records its name. */
function holding(store: Store, ran: string[], name: string, ms = 30): PruneSlice {
  return () =>
    store.transaction(() => {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
      ran.push(name);
    });
}

describe("the daemon's prune in slices (spec 021 D3)", () => {
  it("leaves the lock free between slices, and removes what the prune removes", async () => {
    const { commonDir, store } = prunable();
    const counts = noneRemoved();
    const logged: string[] = [];
    const prune = new SlicedPrune({ log: (line) => logged.push(line) });
    const writer = probe(commonDir);
    let ended = false;
    await prune.run(
      () =>
        pruneSlices(
          connectionOf(store),
          store.worktrees,
          storePaths(commonDir),
          { now: NOW, retentionDays: 7, maxSizeMb: null },
          counts,
        ),
      () => {
        ended = true;
      },
    );
    writer.stop();
    expect(logged).toEqual([]);
    expect(ended).toBe(true);
    // Another writer took the lock again and again while the prune ran.
    expect(writer.seen.free).toBeGreaterThan(10);
    expect(counts).toMatchObject({ resultsRemoved: 600, worktreesRemoved: 1 });
    expect(store.worktrees.get("removed")).toBeNull();
    expect(store.knownStates.list("removed")).toEqual([]);
  });

  it("runs each slice once, in order, `PRUNE_GAP_MS` apart", async () => {
    const store = open(fakeCommonDir());
    const ran: string[] = [];
    const started = performance.now();
    await new SlicedPrune({ log: () => {} }).run(() => [
      holding(store, ran, "a"),
      holding(store, ran, "b"),
      holding(store, ran, "c"),
    ]);
    expect(ran).toEqual(["a", "b", "c"]);
    expect(performance.now() - started).toBeGreaterThanOrEqual(3 * PRUNE_GAP_MS - 5);
  });

  it("tries a slice that met a busy store again, and the wait is told", async () => {
    const commonDir = fakeCommonDir();
    const store = open(commonDir);
    const other = connectionOf(open(commonDir)).db;
    other.exec("BEGIN IMMEDIATE");
    setTimeout(() => other.exec("ROLLBACK"), 400);
    const notes: string[] = [];
    const busyWaits = new BusyWaits({ now: Date.now, note: (text) => notes.push(text) });
    const ran: string[] = [];
    await new SlicedPrune({ log: () => {}, busyWaits }).run(() => [
      holding(store, ran, "a", 0),
      holding(store, ran, "b", 0),
    ]);
    expect(ran).toEqual(["a", "b"]);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain("pruning");
  });

  it("logs a failure, ends the prune there, and runs what follows it", async () => {
    const store = open(fakeCommonDir());
    const ran: string[] = [];
    const logged: string[] = [];
    let then = false;
    await new SlicedPrune({ log: (line) => logged.push(line) }).run(
      () => [
        holding(store, ran, "a", 0),
        () => {
          throw new Error("no such table: gone");
        },
        holding(store, ran, "c", 0),
      ],
      () => {
        then = true;
      },
    );
    expect(ran).toEqual(["a"]);
    expect(logged).toEqual(["prune failed: Error: no such table: gone"]);
    expect(then).toBe(true);
  });

  it("runs one prune at a time, and none after `stop`, which ends one between slices", async () => {
    const store = open(fakeCommonDir());
    const ran: string[] = [];
    const prune = new SlicedPrune({ log: () => {} });
    let then = false;
    const first = prune.run(
      () => [holding(store, ran, "a", 0), holding(store, ran, "b", 0)],
      () => {
        then = true;
      },
    );
    await prune.run(() => [holding(store, ran, "second", 0)]);
    expect(ran).toEqual(["a"]);
    prune.stop();
    await first;
    await prune.run(() => [holding(store, ran, "after", 0)]);
    expect(ran).toEqual(["a"]);
    expect(then).toBe(false);
  });
});
