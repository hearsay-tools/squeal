import { DatabaseSync } from "node:sqlite";
import { setTimeout as delay } from "node:timers/promises";
import { describe, expect, it } from "vitest";
import { readDaemonNotes } from "../../src/core/notes.js";
import {
  BUSY_SLICE_MS,
  BusyWaits,
  setBusyTimeout,
  storePaths,
} from "../../src/core/store/index.js";
import { createRepo, openHarness, openRepoStore, SLOW } from "./helpers.js";

/*
 * Row 011-126 (`tasks/011-122/notes.md`, "With a tier in the hold"): a tier
 * that recorded while another connection held the store's write lock waited
 * the pump's 5 s busy timeout, its requeue's commit waited 5 s more, and the
 * next selection's lookup again: the event loop was held up to 10 s at once,
 * and the tier's files ran again after the free. Now the pump's writes wait
 * a 250 ms slice, and a record that gives up keeps the run's results and is
 * tried again, so its files run once.
 */

/** The daemon's busy timeout for the pump's writes before row 011-126 (C7). */
const DAEMON_BUSY_MS = 5_000;
const HOLD_MS = 6_000;
/** C7: "every ping is answered within 1 s"; the pump's longest hold of the event loop. */
const STALL_MS = 1_000;

/** Holds the store's write lock from a second connection until the returned release. */
function holdWriteLock(commonDir: string): () => void {
  const db = new DatabaseSync(storePaths(commonDir).database);
  db.exec("BEGIN IMMEDIATE");
  return () => {
    db.exec("COMMIT");
    db.close();
  };
}

/** The longest gap between ticks of a 10 ms interval: how long the event loop was held at once. */
function watchStalls(): { stop(): number } {
  let last = performance.now();
  let longest = 0;
  const timer = setInterval(() => {
    const now = performance.now();
    longest = Math.max(longest, now - last);
    last = now;
  }, 10);
  return {
    stop() {
      clearInterval(timer);
      return Math.max(longest, performance.now() - last);
    },
  };
}

describe("a tier that records while another connection holds the write lock (011-126)", () => {
  it(
    `holds the event loop under ${STALL_MS} ms, stores its results after the free, and runs its files once`,
    SLOW,
    async () => {
      const { main, commonDir } = createRepo();
      const store = openRepoStore(commonDir);
      setBusyTimeout(store, DAEMON_BUSY_MS);
      const notes: string[] = [];
      const busyWaits = new BusyWaits({ now: Date.now, note: (text) => notes.push(text) });
      const h = await openHarness(main, store, commonDir, {
        busyWaits,
        busySliceMs: BUSY_SLICE_MS,
      });
      await h.scheduler.start();
      await h.scheduler.idle();

      const runs: string[][] = [];
      let stalls: { stop(): number } | null = null;
      let freed: Promise<void> | null = null;
      h.gate.before = (files) => {
        runs.push(files.map((file) => file.path));
        // The edit's first tier runs while the lock is taken, so its record meets the hold.
        if (runs.length !== 1) return;
        const release = holdWriteLock(commonDir);
        stalls = watchStalls();
        freed = delay(HOLD_MS).then(release);
      };
      // Still passing: a new failure would run once more by design (C5), which is no re-run here.
      h.write("src/math.ts", "export const add = (a: number, b: number) => b + a;\n");
      await h.batch("src/math.ts");
      const revision = h.scheduler.status().revision;
      await expect.poll(() => freed, { timeout: 60_000 }).not.toBeNull();
      await freed;
      await h.scheduler.idle();
      const longest = (stalls as { stop(): number } | null)?.stop() ?? 0;

      const seen = JSON.stringify({ runs, notes });
      expect(longest, seen).toBeLessThan(STALL_MS);
      // Each file the edit queued ran once: the record after the free was the run's, not a re-run's.
      expect(runs, seen).toEqual([["test/math.test.ts"]]);
      const math = store.knownStates
        .list(h.worktreeId)
        .find(({ check }) => check.kind === "test" && check.testPath === "test/math.test.ts");
      expect(math).toMatchObject({ outcome: "pass", observedAt: revision });
      const texts = readDaemonNotes(store, h.worktreeId).map((note) => note.text);
      expect(texts.filter((text) => /scheduler stopped|database is locked/.test(text))).toEqual([]);
      expect(h.errors).toEqual([]);
      expect(notes).toHaveLength(1);
      expect(notes[0]).toMatch(/^the store was busy for [\d.]+ s .*: the results of \d+ files?\b/);
    },
  );
});
