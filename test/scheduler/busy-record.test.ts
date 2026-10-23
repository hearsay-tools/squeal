import { DatabaseSync } from "node:sqlite";
import { describe, expect, it, vi } from "vitest";
import { readDaemonNotes } from "../../src/core/notes.js";
import { BusyWaits, setBusyTimeout, storePaths } from "../../src/core/store/index.js";
import type { Store } from "../../src/core/types/index.js";
import { createRepo, openHarness, openRepoStore, SLOW } from "./helpers.js";

/*
 * Task 001-422: a tier whose record met a busy store stopped the pump with
 * "scheduler stopped running tiers: Error: database is locked", and nothing
 * ran again until the next batch (hearsay-tools/squeal#1). With `busyWaits`
 * the pump resumes by itself once the lock frees, and the episode's one
 * note names what waited. Row 011-126: the record keeps the run's results
 * and lands at its turn, instead of queuing the tier's files again
 * (`busy-hold.test.ts` holds the event loop and the re-run to it).
 */

const BUSY_MS = 50;
const HOLD_MS = 1_500;

/** A busy store's error, as `node:sqlite` throws it. */
function busyError(): Error {
  return Object.assign(new Error("database is locked"), { errcode: 5 });
}

/** Holds the store's write lock from a second connection until the returned release. */
function holdWriteLock(commonDir: string): () => void {
  const db = new DatabaseSync(storePaths(commonDir).database);
  db.exec("BEGIN IMMEDIATE");
  return () => {
    db.exec("COMMIT");
    db.close();
  };
}

/**
 * Holds the busy resume's callback instead of scheduling it, so a test calls
 * it after what it must outlast, as a backoff that outlives it would.
 */
function deferResume(): { readonly resume: () => (() => void) | null; restore(): void } {
  let held: (() => void) | null = null;
  const realSetTimeout = globalThis.setTimeout;
  const handle = realSetTimeout(() => {}, 60_000);
  const spy = vi.spyOn(globalThis, "setTimeout").mockImplementation(((
    ...call: Parameters<typeof setTimeout>
  ) => {
    if (!new Error().stack?.includes("busy-resume")) return realSetTimeout(...call);
    held = call[0] as () => void;
    return handle;
  }) as typeof setTimeout);
  return {
    resume: () => held,
    restore() {
      clearTimeout(handle);
      spy.mockRestore();
    },
  };
}

/**
 * Makes the store's next write transaction throw `error`, or only the next
 * one whose stack names `within`.
 */
function failWrites(store: Store): { fail(error: Error, within?: string): void; restore(): void } {
  const realTransaction = store.transaction.bind(store);
  let next: { error: Error; within: string | undefined } | null = null;
  store.transaction = ((fn: () => unknown) => {
    if (next !== null && (next.within === undefined || new Error().stack?.includes(next.within))) {
      const { error } = next;
      next = null;
      throw error;
    }
    return realTransaction(fn);
  }) as typeof store.transaction;
  return {
    fail(error, within) {
      next = { error, within };
    },
    restore() {
      store.transaction = realTransaction;
    },
  };
}

const realSetTimeout = globalThis.setTimeout;

/** Waits `ms` on the real timers, whatever `deferResume` holds. */
function settle(ms: number): Promise<void> {
  return new Promise((resolve) => realSetTimeout(resolve, ms));
}

describe("a tier recorded on a busy store (001-422)", () => {
  it("resumes the pump once the lock frees, with no new batch", SLOW, async () => {
    const { main, commonDir } = createRepo();
    const store = openRepoStore(commonDir);
    const notes: string[] = [];
    const busyWaits = new BusyWaits({ now: Date.now, note: (text) => notes.push(text) });
    const h = await openHarness(main, store, commonDir, { busyWaits });
    await h.scheduler.start();
    await h.scheduler.idle();

    let releasedAt: number | null = null;
    const runs: string[][] = [];
    h.gate.before = (files) => {
      runs.push(files.map((file) => file.path));
      // The first tier of the edit runs while another connection takes the lock.
      if (runs.length !== 1) return;
      setBusyTimeout(store, BUSY_MS);
      const release = holdWriteLock(commonDir);
      setTimeout(() => {
        release();
        releasedAt = Date.now();
      }, HOLD_MS);
    };
    h.write("src/math.ts", "export const add = (a: number, b: number) => a - b;\n");
    await h.batch("src/math.ts");
    const revision = h.scheduler.status().revision;
    await h.scheduler.idle();

    expect(releasedAt).not.toBeNull();
    // The new failure's run once more (C5) is the pump's after the free, with no batch asking.
    expect(runs.length).toBeGreaterThanOrEqual(2);
    const math = store.knownStates
      .list(h.worktreeId)
      .find(({ check }) => check.kind === "test" && check.testPath === "test/math.test.ts");
    expect(math).toMatchObject({ outcome: "fail", observedAt: revision });
    const texts = readDaemonNotes(store, h.worktreeId).map((note) => note.text);
    expect(texts.filter((text) => /scheduler stopped|database is locked/.test(text))).toEqual([]);
    expect(h.errors).toEqual([]);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatch(/^the store was busy for [\d.]+ s .*: the results of \d+ files?$/);
  });

  /*
   * Review 001-432, B1: a resume armed by a busy write survived a later
   * stall on another error, and started tiers no batch or request asked for
   * (4 runs where 2 were due). Row 011-126: a busy record no longer stops
   * the pump, so the selection's write gives up here.
   */
  it("starts nothing from a resume armed before a stall on another error", SLOW, async () => {
    const { main, commonDir } = createRepo();
    const store = openRepoStore(commonDir);
    const notes: string[] = [];
    const busyWaits = new BusyWaits({ now: Date.now, note: (text) => notes.push(text) });
    const h = await openHarness(main, store, commonDir, { busyWaits, allowErrors: true });
    await h.scheduler.start();
    await h.scheduler.idle();

    const deferred = deferResume();
    const writes = failWrites(store);
    let runs = 0;
    h.gate.before = () => {
      runs++;
      // The tier's record fails otherwise.
      if (runs === 1) writes.fail(new Error("not a busy store"));
    };
    try {
      // The edit's selection gives up on a busy store.
      writes.fail(busyError(), "selectTier");
      h.write("src/math.ts", "export const add = (a: number, b: number) => a - b;\n");
      await h.batch("src/math.ts");
      await expect.poll(() => deferred.resume() !== null, { timeout: 30_000 }).toBe(true);
      expect(runs).toBe(0);
      // A batch restarts the pump before the resume is due; its writes end the busy wait.
      await h.batch("src/math.ts");
      await expect
        .poll(() => h.errors.some((error) => error.message === "not a busy store"), {
          timeout: 30_000,
        })
        .toBe(true);
      expect(runs).toBe(1);
      deferred.resume()?.();
      await settle(1_000);
      expect(runs).toBe(1);
      expect(notes).toHaveLength(1);
      expect(notes[0]).toMatch(/: the next tier$/);
    } finally {
      deferred.restore();
      writes.restore();
    }
  });

  it(
    "starts nothing from a busy wait another error overtook, and names none of it",
    SLOW,
    async () => {
      const { main, commonDir } = createRepo();
      const store = openRepoStore(commonDir);
      const notes: string[] = [];
      const busyWaits = new BusyWaits({ now: Date.now, note: (text) => notes.push(text) });
      const h = await openHarness(main, store, commonDir, { busyWaits, allowErrors: true });
      await h.scheduler.start();
      await h.scheduler.idle();

      const deferred = deferResume();
      const writes = failWrites(store);
      let runs = 0;
      h.gate.before = () => {
        runs++;
      };
      try {
        writes.fail(busyError(), "selectTier");
        h.write("src/math.ts", "export const add = (a: number, b: number) => a - b;\n");
        await h.batch("src/math.ts");
        await expect.poll(() => deferred.resume() !== null, { timeout: 30_000 }).toBe(true);
        // The restarted pump's first write fails otherwise, before any write of it lands.
        writes.fail(new Error("not a busy store"), "selectTier");
        await h.batch("src/math.ts");
        await expect
          .poll(() => h.errors.some((error) => error.message === "not a busy store"), {
            timeout: 30_000,
          })
          .toBe(true);
        deferred.resume()?.();
        await settle(1_000);
        expect(runs).toBe(0);
        // The next batch restarts the pump; its writes land, and the abandoned wait is no news.
        await h.batch("src/math.ts");
        await h.scheduler.idle();
        expect(runs).toBeGreaterThan(0);
        expect(notes).toEqual([]);
      } finally {
        deferred.restore();
        writes.restore();
      }
    },
  );
});
