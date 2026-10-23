import { describe, expect, it, vi } from "vitest";
import { waitFor } from "../watcher/helpers.js";
import {
  A,
  BROKEN,
  doneOf,
  edit,
  holdRun,
  LISTED,
  LISTS,
  listing,
  phaseOf,
  statNow,
} from "./forced-requeue-fixture.js";
import { SLOW } from "./helpers.js";

/*
 * Row 011-120 (`tasks/011-118/notes.md` 2; 011 C4 step 5; 001-171 S1: "a
 * file whose key moves before its re-run runs drops it"). A revision that
 * cancels a forced run queues its file again forced only while what forced
 * it still holds: the file is at the key the tier ran it at, or a strict
 * `run --all --force` checkpoint still holds it. Otherwise it is queued as
 * any miss, looked up at each later key, and current when one has a result.
 */
describe("a cancelled forced run, queued again (row 011-120)", SLOW, () => {
  it("drops a re-run cancelled by a revision: after the revert the file is current, nothing runs", async () => {
    const { h, stored } = await listing();
    const before = h.runsOf(LISTS).length;

    // Its re-run (task 001-171) is the second run after the edit; the gate holds it.
    const rerun = holdRun(h, LISTS, () => h.runsOf(LISTS).length > before);
    // The revert reaches the lock right behind the cancelled re-run's record, before the next tier.
    let revert: Promise<void> | null = null;
    const finish = h.store.runs.finish.bind(h.store.runs);
    vi.spyOn(h.store.runs, "finish").mockImplementation((id, end, at) => {
      finish(id, end, at);
      if (id !== rerun.run.id || revert !== null) return;
      h.write(A, "a\n");
      h.remove(BROKEN);
      revert = h.scheduler.handleBatch(statNow(h, A, BROKEN));
    });
    try {
      // Edit 1 fails: its failure is delivered, and its re-run queued forced starts.
      h.write(BROKEN, "x\n");
      await h.batch(BROKEN);
      await waitFor(() => rerun.run.id !== null, 60_000);
      const failed = h.keyOf(LISTS);
      expect(failed).not.toBe(stored);
      expect(h.sink.stateOf(LISTED)).toMatchObject({ outcome: "fail", validity: "current" });

      // Edit 2 moves the key of the re-run's only file, which ends the re-run and cancels its tier.
      h.write(A, "b\n");
      await h.batch(A);
      expect(h.keyOf(LISTS)).not.toBe(failed);
      await waitFor(rerun.cancelled, 60_000);
    } finally {
      rerun.release();
    }
    await waitFor(() => revert !== null, 60_000);
    await revert;

    // Back at the stored pass: current by lookup, with nothing pending.
    expect(h.keyOf(LISTS)).toBe(stored);
    expect(phaseOf(h, LISTS)).toBeNull();
    expect(h.sink.stateOf(LISTED)).toMatchObject({ outcome: "pass", validity: "current" });
    expect(h.header()).toMatchObject({ counts: { pending: 0, stale: 0, unknown: 0 } });

    // `run --all` requests nothing and completes at once.
    const checkpoint = await h.scheduler.requestFullSuite();
    expect(checkpoint.testFiles).toEqual([]);
    expect(h.store.checkpoints.get(checkpoint.id)?.end).toBe("completed");

    // No further run of the file starts: only the edit's run and its cancelled re-run.
    await h.scheduler.idle();
    expect(h.runsOf(LISTS).slice(before)).toHaveLength(2);
    expect(h.keyOf(LISTS)).toBe(stored);
  });

  it("runs a `run --all --force`'s file forced at the key a revision moved it to, counting only that run", async () => {
    const { h, stored } = await listing();
    // A pass stands at the key the revision moves the file to: a lookup there would take it.
    const moved = await edit(h, "b\n");
    expect(await edit(h, "a\n")).toBe(stored);
    const before = h.runsOf(LISTS).length;

    const forced = holdRun(h);
    let checkpoint = "";
    try {
      const requested = await h.scheduler.requestFullSuite({ force: true });
      checkpoint = requested.id;
      expect(requested.testFiles.map((f) => f.path)).toContain(LISTS);
      await waitFor(() => forced.run.id !== null, 60_000);
      expect(forced.run.key).toBe(stored);
      // The revision moves its key to the stored pass and cancels its tier.
      const done = doneOf(h);
      h.write(A, "b\n");
      await h.batch(A);
      expect(h.keyOf(LISTS)).toBe(moved);
      // The stored pass does not count for the strict checkpoint (task 001-217): the file runs.
      expect(doneOf(h)).toBe(done);
      expect(phaseOf(h, LISTS)).toBe("queued");
      await waitFor(forced.cancelled, 60_000);
    } finally {
      forced.release();
    }
    await h.scheduler.idle();

    // Its own run at the new key, forced past the stored pass, completes the checkpoint.
    const runs = h.runsOf(LISTS).slice(before);
    expect(runs).toHaveLength(2);
    expect(runs[0]?.options.runId).toBe(forced.run.id);
    expect(runs[1]?.report.completedFiles.map((f) => f.path)).toEqual([LISTS]);
    const ran = h.store.results.listForCheck(LISTED, 10).map((r) => r.provenance.runId);
    expect(ran).toContain(runs[1]?.options.runId);
    expect(h.store.checkpoints.get(checkpoint)?.end).toBe("completed");
    expect(h.keyOf(LISTS)).toBe(moved);
    expect(phaseOf(h, LISTS)).toBeNull();
  });
});
