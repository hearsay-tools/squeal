import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, describe, expect, it } from "vitest";
import { readSlowActivity } from "../../src/core/slow/state.js";
import { DEFAULT_POLICY } from "../../src/core/types/index.js";
import { RUN_MISSING } from "../helpers/baseline.js";
import { waitFor } from "../watcher/helpers.js";
import { createRepo, openHarness, openRepoStore, type RecordingRunner, SLOW } from "./helpers.js";

/*
 * Task 001-281: a slow file waiting for its consumer to go idle is looked at
 * again every `SLOW_RECHECK_MS` (15 s). A silent Stop nudges the daemon, and
 * the nudge plans the slow tier at once. The harness keeps the default
 * recheck, so a run within a few seconds came from the nudge, not the timer.
 */

const STRINGS = "test/strings.test.ts";

const slotDirs: string[] = [];
afterEach(() => {
  for (const dir of slotDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A harness whose one slow file waits for its consumer, in a turn, to go idle. */
async function waitingForIdle() {
  const repo = createRepo();
  const store = openRepoStore(repo.commonDir);
  const slotDir = mkdtempSync(join(tmpdir(), "squeal-001-281-slot-"));
  slotDirs.push(slotDir);
  const h = await openHarness(repo.main, store, repo.commonDir, {
    tierSize: 4,
    policy: {
      ...RUN_MISSING,
      slow: { ...DEFAULT_POLICY.slow, trigger: "idle", include: [STRINGS] },
    },
    slow: { slotDir, load: () => [0], cpus: () => 1 },
  });
  const { delivery, consumer } = await h.consumer();
  await delivery.startTurn(consumer);
  await h.scheduler.start();
  await waitFor(() => {
    const activity = readSlowActivity(store, h.worktreeId);
    return activity?.kind === "waiting" && activity.for === "idle";
  }, 60_000);
  // The fast tiers are recorded and the pump has stopped: only the timer or a nudge plans again.
  await h.scheduler.idle();
  return { h, delivery, consumer };
}

describe("the slow tier on a nudge (task 001-281)", SLOW, () => {
  it("starts when the idle consumer's Stop nudges, without the recheck timer", async () => {
    const { h, delivery, consumer } = await waitingForIdle();
    expect(h.runsOf(STRINGS)).toHaveLength(0);
    await delivery.endTurn(consumer);
    h.scheduler.nudge();
    // Well inside the 15 s recheck the slow tier armed as it published "waiting for idle".
    await waitFor(() => h.runsOf(STRINGS).length === 1, 8_000);
  });

  it("ignores a nudge while the scheduler starts, then waits for idle as usual (review wave-13ak, B1)", async () => {
    const repo = createRepo();
    const store = openRepoStore(repo.commonDir);
    const slotDir = mkdtempSync(join(tmpdir(), "squeal-001-287-slot-"));
    slotDirs.push(slotDir);
    const h = await openHarness(repo.main, store, repo.commonDir, {
      tierSize: 4,
      policy: {
        ...RUN_MISSING,
        slow: { ...DEFAULT_POLICY.slow, trigger: "idle", include: [STRINGS] },
      },
      slow: { slotDir, load: () => [0], cpus: () => 1 },
    });
    const { delivery, consumer } = await h.consumer();
    await delivery.startTurn(consumer);
    // The start holds at its first runner call, past the ledger and before the context.
    const runner = h.runner as { environment: RecordingRunner["environment"] };
    const environment = runner.environment;
    let reached = false;
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    runner.environment = async () => {
      reached = true;
      await held;
      return environment();
    };
    const starting = h.scheduler.start();
    await waitFor(() => reached, 30_000);
    expect(() => h.scheduler.nudge()).not.toThrow();
    runner.environment = environment;
    release();
    await starting;
    // Started, the slow file still waits for its consumer to go idle; the early nudge forced nothing.
    await waitFor(() => {
      const activity = readSlowActivity(store, h.worktreeId);
      return activity?.kind === "waiting" && activity.for === "idle";
    }, 60_000);
    await h.scheduler.idle();
    expect(h.runsOf(STRINGS)).toHaveLength(0);
    await delivery.endTurn(consumer);
    h.scheduler.nudge();
    await waitFor(() => h.runsOf(STRINGS).length === 1, 8_000);
  });

  it("leaves the slow file waiting while its consumer is still in a turn", async () => {
    const { h } = await waitingForIdle();
    h.scheduler.nudge();
    await delay(1_000);
    expect(h.runsOf(STRINGS)).toHaveLength(0);
    expect(readSlowActivity(h.store, h.worktreeId)).toEqual({ kind: "waiting", for: "idle" });
  });
});
