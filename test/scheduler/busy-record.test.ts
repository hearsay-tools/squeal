import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { readDaemonNotes } from "../../src/core/notes.js";
import { BusyWaits, setBusyTimeout, storePaths } from "../../src/core/store/index.js";
import { createRepo, openHarness, openRepoStore, SLOW } from "./helpers.js";

/*
 * Task 001-422: a tier whose record met a busy store stopped the pump with
 * "scheduler stopped running tiers: Error: database is locked", and nothing
 * ran again until the next batch (hearsay-tools/squeal#1). With `busyWaits`
 * the pump resumes by itself once the lock frees, and the episode's one
 * note names what waited.
 */

const BUSY_MS = 50;
const HOLD_MS = 1_500;

/** Holds the store's write lock from a second connection until the returned release. */
function holdWriteLock(commonDir: string): () => void {
  const db = new DatabaseSync(storePaths(commonDir).database);
  db.exec("BEGIN IMMEDIATE");
  return () => {
    db.exec("COMMIT");
    db.close();
  };
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
    expect(runs.length).toBeGreaterThanOrEqual(2);
    const math = store.knownStates
      .list(h.worktreeId)
      .find(({ check }) => check.kind === "test" && check.testPath === "test/math.test.ts");
    expect(math).toMatchObject({ outcome: "fail", observedAt: revision });
    const texts = readDaemonNotes(store, h.worktreeId).map((note) => note.text);
    expect(texts.filter((text) => /scheduler stopped|database is locked/.test(text))).toEqual([]);
    expect(h.errors).toEqual([]);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatch(
      /^the store was busy for [\d.]+ s .*: \d+ files? of a tier queued again/,
    );
  });
});
