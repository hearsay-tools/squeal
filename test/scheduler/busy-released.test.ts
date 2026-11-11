import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { readDaemonNotes } from "../../src/core/notes.js";
import { setBusyTimeout } from "../../src/core/store/open.js";
import { storePaths } from "../../src/core/store/paths.js";
import { git } from "../hash/git-repo.js";
import { RUN_MISSING } from "../helpers/baseline.js";
import { busyWaits } from "./busy-fixture.js";
import { SLOW } from "./cleanup.js";
import { gitMay } from "./merge-hold-fixture.js";
import { createRepo, openRepoStore } from "./repo.js";
import { openHarness } from "./vitest-harness.js";

/*
 * Spec 021 D2 (row 021-08): a merge hold's end hands its released paths to
 * one watch pass (row 011-72), which no change feed retries. It waited the
 * store's own wait and, refused, the paths were gone: the bytes the abort
 * restored had no revision until a tier ran at the conflicted keys and its
 * run found them moved. A second connection takes the store's write lock
 * as that pass begins its write.
 */

/** The store's own wait: the daemon's 5 s, shorter than the hold. */
const OWN_MS = 100;
/** The daemon's `BUSY_SLICE_MS`, short. */
const SLICE_MS = 25;
const HOLD_MS = 1_500;
const MATH = "src/math.ts";
const adding = (n: number) => `export const add = (a: number, b: number) => a + b + ${n};\n`;

describe("a merge hold's released paths on a busy store (spec 021 D2)", () => {
  it("are reconciled once the lock frees, before any tier", SLOW, async () => {
    const { main, commonDir } = createRepo();
    git(main, ["checkout", "-q", "-b", "side"]);
    writeFileSync(join(main, MATH), adding(2));
    git(main, ["commit", "-qam", "side"]);
    git(main, ["checkout", "-q", "main"]);
    writeFileSync(join(main, MATH), adding(3));
    git(main, ["commit", "-qam", "main"]);
    const store = openRepoStore(commonDir);
    // The start runs every file, so the restored bytes' keys have a stored pass.
    const h = await openHarness(main, store, commonDir, {
      busyWaits: busyWaits(),
      busySliceMs: SLICE_MS,
      policy: RUN_MISSING,
    });
    await h.scheduler.start();
    await h.scheduler.idle();
    const before = h.keyOf("test/math.test.ts");

    expect(gitMay(main, ["merge", "side"])).toBe(1);
    await h.batch(MATH);
    const conflicted = h.scheduler.status().revision;
    expect(h.keyOf("test/math.test.ts")).not.toBe(before);
    const runs = h.runner.runs.length;

    // The released paths' pass meets a lock another connection takes as it begins its write.
    const transaction = store.transaction.bind(store);
    let held: DatabaseSync | null = null;
    store.transaction = ((fn: () => unknown) => {
      if (held === null && new Error().stack?.includes("reconcileBatch")) {
        held = new DatabaseSync(storePaths(commonDir).database);
        held.exec("BEGIN IMMEDIATE");
        const lock = held;
        setTimeout(() => {
          lock.exec("COMMIT");
          lock.close();
        }, HOLD_MS);
      }
      return transaction(fn);
    }) as typeof store.transaction;
    setBusyTimeout(store, OWN_MS);
    try {
      git(main, ["merge", "--abort"]);
      await expect
        .poll(() => h.scheduler.status().revision, { timeout: 15_000 })
        .toBe(conflicted + 1);
      await h.scheduler.idle();

      expect(held).not.toBeNull();
      // No tier ran at the conflicted keys: the restored bytes' revision came first, at the stored pass.
      expect(h.runner.runs.length).toBe(runs);
      expect(h.keyOf("test/math.test.ts")).toBe(before);
      expect(h.errors).toEqual([]);
      const texts = readDaemonNotes(store, h.worktreeId).map((note) => note.text);
      expect(texts.filter((text) => /could not|database is locked/.test(text))).toEqual([]);
    } finally {
      store.transaction = transaction;
      setBusyTimeout(store, 10_000);
    }
  });
});
