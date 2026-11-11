import { describe, expect, it } from "vitest";
import { readDaemonNotes } from "../../src/core/notes.js";
import { BusyWaits } from "../../src/core/store/busy.js";
import { setBusyTimeout } from "../../src/core/store/open.js";
import { storePaths } from "../../src/core/store/paths.js";
import type { TestFileRef } from "../../src/core/types/keys.js";
import { holdLock, type LockHolder } from "../status/hold-lock.js";
import { SLOW } from "./cleanup.js";
import { createRepo, openRepoStore } from "./repo.js";
import { openHarness } from "./vitest-harness.js";

/*
 * Spec 021 D2 (row 021-08; #138, row 011-104): the apply of a revision's
 * runner part waited one busy timeout on a busy store and, refused, was
 * noted and counted refined: nothing applied it again, so its new test
 * files kept no key. A second process holds the store's write lock here
 * past the store's own wait, as `research/probes/issue-138` did.
 */

/** The store's own wait: the daemon's 5 s, shorter than the hold, so both revisions meet it. */
const OWN_MS = 100;
/** The daemon's `BUSY_SLICE_MS`, short. */
const SLICE_MS = 25;
const HOLD_MS = 2_000;
const BODY = "import { expect, it } from 'vitest';\nit('runs', () => expect(1).toBe(1));\n";

describe("a refinement a busy store refused (spec 021 D2)", () => {
  it("is applied once the lock frees, with every revision behind it in order", SLOW, async () => {
    const { main, commonDir } = createRepo();
    const store = openRepoStore(commonDir);
    const notes: string[] = [];
    const busyWaits = new BusyWaits({ now: Date.now, note: (text) => notes.push(text) });
    const h = await openHarness(main, store, commonDir, { busyWaits, busySliceMs: SLICE_MS });
    await h.scheduler.start();
    await h.scheduler.idle();

    // The first closure of revision 1's new file waits until revision 2 is stored and the lock held.
    let arrived = (): void => {};
    let release = (): void => {};
    const entered = new Promise<void>((resolve) => {
      arrived = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const closure = h.runner.closure;
    let first = true;
    h.runner.closure = async (testFile: TestFileRef) => {
      const result = await closure(testFile);
      if (first && testFile.path === "test/new-one.test.ts") {
        first = false;
        arrived();
        await gate;
      }
      return result;
    };
    h.write("test/new-one.test.ts", BODY);
    await h.batch("test/new-one.test.ts");
    await entered;
    h.write("test/new-two.test.ts", BODY);
    await h.batch("test/new-two.test.ts");
    const latest = store.revisions.latest(h.worktreeId)?.number;

    setBusyTimeout(store, OWN_MS);
    let holder: LockHolder | null = null;
    try {
      holder = await holdLock(storePaths(commonDir).database, "immediate", HOLD_MS);
      release();
      await holder.released;
      await h.scheduler.idle();

      expect(h.keyOf("test/new-one.test.ts")).not.toBeNull();
      expect(h.keyOf("test/new-two.test.ts")).not.toBeNull();
      expect(h.header()).toMatchObject({ refinedRevision: latest, runnerPartPending: false });
      expect(h.errors).toEqual([]);
      const texts = readDaemonNotes(store, h.worktreeId).map((note) => note.text);
      expect(texts.filter((text) => /could not|database is locked/.test(text))).toEqual([]);
      expect(notes.join("\n")).toMatch(/the runner part of revision \d+/);
    } finally {
      release();
      holder?.child.kill("SIGKILL");
      setBusyTimeout(store, 10_000);
    }
  });
});
