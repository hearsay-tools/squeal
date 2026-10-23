import { describe, expect, it } from "vitest";
import { waitFor } from "../watcher/helpers.js";
import {
  A,
  doneOf,
  edit,
  holdRun,
  LISTED,
  LISTS,
  listing,
  phaseOf,
} from "./forced-requeue-fixture.js";
import { SLOW } from "./helpers.js";

/*
 * Row 011-120, found while making a `run --all --force` keep its file forced
 * at a moved key (`tasks/011-120/notes.md`). A strict checkpoint counts only
 * its own run of a file (task 001-217): one it holds whose key a revision
 * moves while it runs takes no stored result and runs forced at the new
 * key. Any other checkpoint takes the lookup there as before; back at the
 * key its results stand under, `checkpoint-lookup.test.ts` (row 011-118).
 */
const RED = "test/red.test.ts";
const RED_TEST = `import { it } from "vitest";

it("is red", () => {
  throw new Error("red");
});
`;

describe("a running file's lookup at a moved key (row 011-120)", SLOW, () => {
  it("is taken for a `run --all` that is not forced: it completes at once, nothing runs there", async () => {
    const { h } = await listing();
    const moved = await edit(h, "b\n");
    await edit(h, "a\n");
    const before = h.runsOf(LISTS).length;

    // An edit's run at a key with no result is held; a `run --all` joins it.
    const edited = holdRun(h);
    let checkpoint = "";
    try {
      h.write(A, "c\n");
      await h.batch(A);
      await waitFor(() => edited.run.id !== null, 60_000);
      const requested = await h.scheduler.requestFullSuite();
      checkpoint = requested.id;
      expect(requested.testFiles.map((f) => f.path)).toEqual([LISTS]);

      // The revision moves its key to a stored pass: current by lookup, and the checkpoint completes.
      h.write(A, "b\n");
      await h.batch(A);
      expect(h.keyOf(LISTS)).toBe(moved);
      expect(h.sink.stateOf(LISTED)).toMatchObject({ outcome: "pass", validity: "current" });
      expect(h.store.checkpoints.get(checkpoint)?.end).toBe("completed");
      await waitFor(edited.cancelled, 60_000);
    } finally {
      edited.release();
    }
    await h.scheduler.idle();
    expect(h.runsOf(LISTS).slice(before)).toHaveLength(1);
    expect(h.keyOf(LISTS)).toBe(moved);
    expect(phaseOf(h, LISTS)).toBeNull();
  });

  it("is not taken back at its results' key for a `run --all --force`: it runs forced once, and completes", async () => {
    // The failing file goes first (C4 step 4), so the edit below finds the file still queued.
    const { h, stored } = await listing({ [RED]: RED_TEST });
    const before = h.runsOf(LISTS).length;

    const red = holdRun(h, RED);
    const forced = holdRun(h);
    let checkpoint = "";
    try {
      const requested = await h.scheduler.requestFullSuite({ force: true });
      checkpoint = requested.id;
      await waitFor(() => red.run.id !== null, 60_000);
      expect(forced.run.id).toBeNull();
      // Queued forced, it keeps that at its new key (no result there): its own run starts there.
      h.write(A, "b\n");
      await h.batch(A);
      const moved = h.keyOf(LISTS);
      expect(moved).not.toBe(stored);
      red.release();
      await waitFor(() => forced.run.id !== null, 60_000);
      expect(forced.run.key).toBe(moved);

      // The revert moves it back to the key its pass stands under, while its own run runs:
      // that pass does not count, and the file is queued forced there.
      const done = doneOf(h);
      h.write(A, "a\n");
      await h.batch(A);
      expect(h.keyOf(LISTS)).toBe(stored);
      expect(doneOf(h)).toBe(done);
      expect(phaseOf(h, LISTS)).toBe("queued");
      await waitFor(forced.cancelled, 60_000);
    } finally {
      red.release();
      forced.release();
    }
    await h.scheduler.idle();

    // The cancelled run at the moved key, then one forced run at the stored key.
    const runs = h.runsOf(LISTS).slice(before);
    expect(runs).toHaveLength(2);
    expect(runs[1]?.report.completedFiles.map((f) => f.path)).toEqual([LISTS]);
    expect(h.store.checkpoints.get(checkpoint)?.end).toBe("completed");
    expect(h.keyOf(LISTS)).toBe(stored);
    expect(phaseOf(h, LISTS)).toBeNull();
  });
});
