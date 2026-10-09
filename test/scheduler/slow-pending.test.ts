import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_POLICY } from "../../src/core/types/index.js";
import { waitFor } from "../watcher/helpers.js";
import { createRepo, openHarness, openRepoStore, SLOW } from "./helpers.js";

/*
 * Task 004-29: `Scheduler.slowPending` says whether a slow file is queued or
 * running, so a daemon whose last session left drains them before it exits
 * (001 D10 as amended). The one slow file waits on an injected load, then
 * holds its run until the test lets it end.
 */

const STRINGS = "test/strings.test.ts";

const slotDirs: string[] = [];
afterEach(() => {
  for (const dir of slotDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("Scheduler.slowPending (task 004-29)", SLOW, () => {
  it("is true while a slow file waits or runs, and false once it is recorded", async () => {
    const repo = createRepo();
    const store = openRepoStore(repo.commonDir);
    const slotDir = mkdtempSync(join(tmpdir(), "squeal-004-29-slot-"));
    slotDirs.push(slotDir);
    let load = 4;
    let reads = 0;
    const h = await openHarness(repo.main, store, repo.commonDir, {
      tierSize: 4,
      policy: { slow: { ...DEFAULT_POLICY.slow, include: [STRINGS], maxDeferMs: 60_000 } },
      slow: {
        slotDir,
        recheckMs: 25,
        load: () => {
          if (load > 1) reads += 1;
          return [load];
        },
        cpus: () => 1,
      },
    });
    let started = false;
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const run = h.runner.run.bind(h.runner);
    h.runner.run = async (files, runOptions) => {
      if (files.some((f) => f.path === STRINGS)) {
        started = true;
        await gate;
      }
      return run(files, runOptions);
    };
    expect(h.scheduler.slowPending()).toBe(false);
    await h.scheduler.start();
    // The fast files are done and the slow one waits for the load guard.
    await waitFor(() => reads >= 2, 60_000);
    expect(h.scheduler.slowPending()).toBe(true);

    load = 0;
    await waitFor(() => started, 30_000);
    // Out of the queue, in flight.
    expect(h.scheduler.slowPending()).toBe(true);

    release();
    await waitFor(() => !h.scheduler.slowPending(), 30_000);
    expect(h.runsOf(STRINGS)).toHaveLength(1);
    await h.scheduler.close();
    expect(h.scheduler.slowPending()).toBe(false);
  });
});
