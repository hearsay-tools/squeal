import { describe, expect, it } from "vitest";
import { slotHarness, testPath } from "./slots-fixture.js";

/*
 * Task 011-21 slice 2, done-when 3 (`research/streaming-lanes.md` finding 1,
 * "Per-file overhead", and test 6): a slot costs a selection, a record, a
 * pool acquisition and a `node` start, which a tier pays once for all its
 * files but the start. 300 node:test files that each spin about 50 ms run
 * a forced pass in at most 1.2 times the time one backlog tier of them
 * takes, and the slots that end while a record gathers or holds the lock
 * share its commit: fewer sink commits than files. Each commit holds the
 * thread 55 ms, the least a sink call took on cezar's store, so a commit per
 * slot, 16.5 s of them, would not fit: one per slot with no gather took 1.39
 * times at 50 ms.
 */
const FILES = 300;
const APPLY_MS = 55;

async function forcedPass(slots: boolean, applyMs: number) {
  const files = Array.from({ length: FILES }, (_, i) => ({
    name: `o${String(i).padStart(3, "0")}`,
    sleepMs: 0,
    spinMs: 50,
  }));
  const { h, runs } = await slotHarness({
    files,
    hostSlots: 4,
    backlogTierSize: FILES,
    slots,
    applyMs,
  });
  await h.scheduler.start();
  await h.scheduler.idle();
  const before = { runs: runs.length, commits: h.sink.calls.length };
  const started = performance.now();
  await h.scheduler.requestFullSuite({ force: true });
  await h.scheduler.idle();
  const ms = performance.now() - started;
  const pass = runs.slice(before.runs);
  const commits = h.sink.calls
    .slice(before.commits)
    .filter((call) => call.method === "applyResults").length;
  const stored = files.every((f) =>
    h.store.knownStates
      .list(h.worktreeId)
      .some((s) => s.check.testPath === testPath(f.name) && s.outcome === "pass"),
  );
  await h.scheduler.close();
  return { ms, pass, commits, stored };
}

describe("scheduler: a node:test backlog in one-file slots, per-file overhead (task 011-21 slice 2)", () => {
  it("3. runs 300 files of about 50 ms within 1.2 times one tier's time, with fewer commits than files", {
    timeout: 300_000,
  }, async () => {
    const tier = await forcedPass(false, APPLY_MS);
    const slots = await forcedPass(true, APPLY_MS);
    console.log(
      `011-21 slots: 300 files in ${Math.round(slots.ms)} ms in ${slots.pass.length} runs and ${slots.commits} commits; one tier ${Math.round(tier.ms)} ms in ${tier.pass.length} runs (${(slots.ms / tier.ms).toFixed(2)} times)`,
    );
    expect(tier.stored && slots.stored).toBe(true);
    expect(tier.pass).toHaveLength(1);
    expect(slots.pass).toHaveLength(FILES);
    expect(slots.pass.every((run) => run.files.length === 1)).toBe(true);
    expect(slots.ms).toBeLessThanOrEqual(tier.ms * 1.2);
    expect(slots.commits).toBeLessThan(FILES);
  });
});
