import { rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RUN_MISSING } from "../helpers/baseline.js";
import { waitFor } from "../watcher/helpers.js";
import { SLOW } from "./cleanup.js";
import { createRepo, openRepoStore } from "./repo.js";
import { openHarness } from "./vitest-harness.js";

/*
 * Row 018-12, review wave 3.6-r2 B2-R1: a request's file ends when that
 * request's own record accepts the file's completion. A forced `run --all`
 * counts only its own run of a file (task 001-217), so the end of a
 * baseline run already in flight when it was asked ends nothing of it; its
 * own run's end counts once.
 */

const MATH = "test/math.test.ts";
const OTHERS = [
  "test/gen.test.ts",
  "test/plain.test.ts",
  "test/strings.test.ts",
  "test/upper.test.ts",
];

const gates: (() => void)[] = [];
// Before the scheduler's cleanup, which waits for the run a gate holds (hooks run as a stack).
afterEach(() => {
  for (const open of gates.splice(0)) open();
});

/** A gate a run waits at until `open`; opened when the test ends. */
function gate(): { wait: Promise<void>; open: () => void; reached: boolean } {
  let open = () => {};
  const wait = new Promise<void>((resolve) => {
    open = resolve;
  });
  gates.push(open);
  return { wait, open, reached: false };
}

describe("Scheduler.requestProgress: a forced run --all (row 018-12)", SLOW, () => {
  it("counts nothing for an older baseline run's end, and the forced run's own end once", async () => {
    const repo = createRepo();
    for (const path of OTHERS) rmSync(join(repo.main, path));
    const store = openRepoStore(repo.commonDir);
    const h = await openHarness(repo.main, store, repo.commonDir, {
      policy: RUN_MISSING,
      tierSize: 1,
      runnerPartBesideRun: true,
    });
    const baseline = gate();
    const forced = gate();
    h.runner.beforeRun = async () => {
      const held = baseline.reached ? forced : baseline;
      held.reached = true;
      await held.wait;
    };
    await h.scheduler.start();
    await waitFor(() => baseline.reached, 60_000);
    const record = await h.scheduler.requestFullSuite({ force: true });
    expect(record.owner).toBe(record.id);
    expect(h.scheduler.requestProgress?.()).toBe(0);

    baseline.open();
    await waitFor(() => forced.reached, 60_000);
    expect(h.store.checkpoints.get(record.id)?.end).toBeNull();
    expect(h.scheduler.requestProgress?.()).toBe(0);

    forced.open();
    await h.scheduler.idle();
    expect(h.runsOf(MATH)).toHaveLength(2);
    expect(h.store.checkpoints.get(record.id)?.end).toBe("completed");
    expect(h.scheduler.requestProgress?.()).toBe(1);
  });
});
