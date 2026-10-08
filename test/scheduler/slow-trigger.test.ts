import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, describe, expect, it } from "vitest";
import { readTurn } from "../../src/core/delivery/turn.js";
import { DEFAULT_POLICY } from "../../src/core/types/index.js";
import { waitFor } from "../watcher/helpers.js";
import { createRepo, type Harness, openHarness, openRepoStore, SLOW } from "./helpers.js";

/*
 * Spec 004 D2, review wave-1 B1: the trigger that chose a slow file is checked
 * again once the slot and the load guard are passed. A consumer may enter a
 * turn during the guard's wait with no file batch to preempt it; the file then
 * stays pending, and runs once a trigger holds again.
 */

const STRINGS = "test/strings.test.ts";

const slotDirs: string[] = [];
afterEach(() => {
  for (const dir of slotDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A harness whose one slow file waits on an injected load of 4 per CPU until `drop()`. */
async function guarded() {
  const repo = createRepo();
  const store = openRepoStore(repo.commonDir);
  const slotDir = mkdtempSync(join(tmpdir(), "squeal-004-20-slot-"));
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
  const turns: string[] = [];
  const { delivery, consumer } = await h.consumer();
  const run = h.runner.run.bind(h.runner);
  h.runner.run = (files, runOptions) => {
    if (files.some((f) => f.path === STRINGS)) turns.push(readTurn(store, consumer).turn);
    return run(files, runOptions);
  };
  await h.scheduler.start();
  // The fast files are done and the guard has read the high load.
  await waitFor(() => reads >= 2, 60_000);
  return {
    h,
    delivery,
    consumer,
    turns,
    drop: () => {
      load = 0;
    },
  };
}

const slowRuns = (h: Harness) => h.runsOf(STRINGS).length;

describe("a slow file whose trigger went during the load guard's wait (spec 004 D2)", SLOW, () => {
  it("stays pending while the consumer is in a turn, and runs once it is idle", async () => {
    const { h, delivery, consumer, turns, drop } = await guarded();
    expect(slowRuns(h)).toBe(0);
    await delivery.startTurn(consumer);
    drop();
    await delay(400);
    expect(turns).toEqual([]);
    await delivery.endTurn(consumer);
    await waitFor(() => slowRuns(h) === 1, 30_000);
    expect(turns).toEqual(["idle"]);
  });

  it("still runs in a turn when run --slow asked for it", async () => {
    const { h, delivery, consumer, turns, drop } = await guarded();
    await delivery.startTurn(consumer);
    await h.scheduler.requestSlowSuite();
    drop();
    await waitFor(() => slowRuns(h) === 1, 30_000);
    expect(turns).toEqual(["in-turn"]);
  });
});
