import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { worktreeIdFor } from "../../src/core/fs/index.js";
import { testFileId } from "../../src/core/keys/index.js";
import { consumersIdle } from "../../src/core/scheduler/slow-tier.js";
import { slowTierText } from "../../src/core/state/index.js";
import { DEFAULT_POLICY, type Policy } from "../../src/core/types/index.js";
import { createRepo, openHarness, openRepoStore, ref, SLOW } from "./helpers.js";
import { HARNESS_DAEMON } from "./store-wait.js";

/*
 * Review wave-13ax B1, task 001-323: the slow-tier line's off-line claims an
 * automatic run only for the slow files Squeal queued (004 D8 as amended).
 * Under `baseline.onStart: "lookup-only"` a slow miss is never queued, and a
 * pause does not queue it (`SlowTier.nudge` pumps queued work only): the line
 * names `squeal run --slow` instead. Against the real scheduler, so the
 * sentence is checked against what the scheduler does, not a string.
 */

const STRINGS = "test/strings.test.ts";
const LANDED = "Squeal runs them when the agent pauses";
/** The line once the file ran: nothing left to claim a run for, so the landed sentence. */
const CURRENT = /^Slow tier: 1 test file; 1 current .*\. Squeal runs them when the agent pauses\.$/;

const slotDirs: string[] = [];
afterEach(() => {
  for (const dir of slotDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function harness(onStart: Policy["baseline"]["onStart"]) {
  const repo = createRepo();
  const store = openRepoStore(repo.commonDir);
  const slotDir = mkdtempSync(join(tmpdir(), "squeal-001-323-slot-"));
  slotDirs.push(slotDir);
  const policy = {
    baseline: { ...DEFAULT_POLICY.baseline, onStart },
    slow: { ...DEFAULT_POLICY.slow, include: [STRINGS] },
  };
  // The header reads the slow view from the policy file at the worktree row's root.
  writeFileSync(join(repo.main, "squeal.config.json"), JSON.stringify(policy));
  store.worktrees.upsert({
    id: worktreeIdFor(repo.main),
    root: repo.main,
    commonDir: repo.commonDir,
    isMain: true,
    registeredAt: 1,
    daemon: {
      ...HARNESS_DAEMON,
      socketPath: "/tmp/squeal-test.sock",
      heartbeatAt: Date.now(),
      heartbeatIntervalMs: 600_000,
    },
  });
  const h = await openHarness(repo.main, store, repo.commonDir, {
    tierSize: 4,
    policy,
    slow: { slotDir, recheckMs: 25, load: () => [0], cpus: () => 1 },
  });
  const { delivery, consumer } = await h.consumer();
  await h.scheduler.start();
  // A turn, then a silent Stop: the consumer goes idle and the scheduler is nudged.
  await delivery.startTurn(consumer);
  await delivery.endTurn(consumer);
  h.scheduler.nudge();
  await h.scheduler.idle();
  const line = () => slowTierText(h.header(), "squeal") ?? "";
  const row = () =>
    store.testFileKeys
      .list(h.worktreeId)
      .find((r) => testFileId(r.testFile) === testFileId(ref(STRINGS)));
  return { h, store, line, row };
}

describe("the slow-tier off-line's automatic-run claim (review wave-13ax B1)", SLOW, () => {
  it("under lookup-only, promises no run Squeal will not make; run --slow runs the file", async () => {
    const { h, store, line, row } = await harness("lookup-only");
    expect(consumersIdle(store, h.worktreeId, Date.now())).toBe(true);
    expect(h.runsOf(STRINGS)).toEqual([]);
    expect(row()?.pending).toBeNull();
    expect(line()).toBe(
      `Slow tier: 1 test file; 1 not run at revision ${h.header().revision}. ` +
        "Squeal has not queued them; `squeal run --slow` runs them now.",
    );
    expect(line()).not.toContain(LANDED);

    // The explicit request: the same file runs once, so the line's command is true.
    await h.scheduler.requestSlowSuite();
    await h.scheduler.idle();
    expect(h.runsOf(STRINGS)).toHaveLength(1);
    expect(line()).toMatch(CURRENT);
  });

  it("under the default policy, runs the slow file on the pause the line promises", async () => {
    const { h, line } = await harness("lookup-then-run-missing");
    expect(h.runsOf(STRINGS)).toHaveLength(1);
    expect(line()).toMatch(CURRENT);
  });
});
