import { rmSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readRetries } from "../../src/core/retry/records.js";
import { SLOW } from "./cleanup.js";
import { openRepoStore } from "./repo.js";
import { ask, FLAKY, failing, flakyRepo, loadKnob, options, pass } from "./retry-fixture.js";
import { openHarness } from "./vitest-harness.js";

/*
 * Row 018-12 (spec 018 wave 3.6), review wave 3.6 B3: a retry is the
 * agent's explicit request, so its run's end counts in
 * `Scheduler.requestProgress` wherever the daemon claims and queues it: at
 * `squeal retry`, in a later reconciliation pass once the load falls, or at
 * start for a retry an earlier daemon left. Waiting at a closed load gate is
 * no progress.
 */

describe("Scheduler.requestProgress: a retry's run (row 018-12)", SLOW, () => {
  it("counts the end of a load retry that a reconciliation pass queues once the load falls", async () => {
    const repo = flakyRepo();
    const load = loadKnob();
    const store = openRepoStore(repo.commonDir);
    const h = await openHarness(repo.main, store, repo.commonDir, options(load));
    await failing(h);
    rmSync(repo.marker);
    ask(store, h, "review-load-retry", "load");
    await h.scheduler.requestRetries();
    await h.scheduler.idle();
    expect(h.runsOf(FLAKY)).toHaveLength(1);
    expect(h.scheduler.requestProgress?.()).toBe(0);
    load.set(1);
    await pass(h);
    expect(h.runsOf(FLAKY)).toHaveLength(2);
    expect(h.scheduler.requestProgress?.()).toBe(1);
  });

  it("counts the end of a retry an earlier daemon left, which the next one queues at start", async () => {
    const repo = flakyRepo();
    const load = loadKnob();
    const store = openRepoStore(repo.commonDir);
    const first = await openHarness(repo.main, store, repo.commonDir, options(load));
    await failing(first);
    ask(store, first, "s1", "load");
    await first.scheduler.requestRetries();
    await first.scheduler.close();
    rmSync(repo.marker);
    load.set(1);

    const second = await openHarness(repo.main, store, repo.commonDir, options(load));
    await second.scheduler.start();
    await second.scheduler.idle();
    expect(readRetries(store)[0]?.end?.outcome).toBe("passed");
    expect(second.scheduler.requestProgress?.()).toBe(1);
  });
});
