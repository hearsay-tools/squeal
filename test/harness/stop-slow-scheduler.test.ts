import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { worktreeIdFor } from "../../src/core/fs/index.js";
import { readDaemonNotes } from "../../src/core/notes.js";
import { readSlowActivity } from "../../src/core/slow/state.js";
import { DEFAULT_POLICY, type Policy, type SlowTierWait } from "../../src/core/types/index.js";
import { CODE_OFF } from "../helpers/policy.js";
import { createRepo, openHarness, openRepoStore, SLOW } from "../scheduler/helpers.js";
import { HARNESS_DAEMON } from "../scheduler/store-wait.js";
import { waitFor } from "../watcher/helpers.js";
import {
  HARNESSES,
  type Harness,
  listenAsDaemon,
  markStopWait,
  stopThenWait,
} from "./stop-slow-helpers.js";

/*
 * Spec 019 D4 step 1 (row 019-09) against the real scheduler and Vitest:
 * the waiting Stop entry's `run-slow` request reaches the daemon's
 * `requestSlowSuite`, as `squeal run --slow` does. Case C4 of
 * `research/stop-wait.md`: under `baseline.onStart: "lookup-only"` a slow
 * miss is keyed, not run and not queued, and the 2 s entry's nudge pumps
 * queued work only. Case C5: a queued slow file the load guard holds (load 8
 * per CPU, `slow.maxDeferMs` 600 s) runs at once. Before 019-09 both waited
 * out the bound and blocked. In the `basic` fixture `test/strings.test.ts`
 * reads `src/strings.ts` only, so an edit of `src/math.ts` leaves it alone.
 */

const STRINGS = "test/strings.test.ts";
/** Far below the guard's 600 s and the bound: the request, not either, ended the wait. */
const PROMPT_MS = 30_000;

async function fixture(harness: Harness, onStart: Policy["baseline"]["onStart"], load: number) {
  const repo = createRepo();
  const store = openRepoStore(repo.commonDir);
  const slotDir = mkdtempSync(join(tmpdir(), "squeal-019-09-slot-"));
  onTestFinished(() => rmSync(slotDir, { recursive: true, force: true }));
  const policy = {
    baseline: { ...DEFAULT_POLICY.baseline, onStart },
    slow: { ...DEFAULT_POLICY.slow, trigger: "idle" as const, include: [STRINGS] },
    stop: { ...DEFAULT_POLICY.stop, requireSlowSuite: true, slowWaitMs: 45_000 },
  };
  // The hooks read the policy file at the worktree row's root.
  writeFileSync(join(repo.main, "squeal.config.json"), JSON.stringify({ ...CODE_OFF, ...policy }));
  const worktreeId = worktreeIdFor(repo.main);
  store.worktrees.upsert({
    id: worktreeId,
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
    slow: { slotDir, recheckMs: 25, load: () => [load], cpus: () => 1 },
  });
  await h.scheduler.start();
  const root = { root: repo.main };
  const ran = () => h.runsOf(STRINGS).length;
  /** The session's turn: registered by its hooks, then an edit (004-67) that leaves the slow file alone. */
  const turn = async () => {
    await harness.startTurn(root);
    await listenAsDaemon(store, worktreeId, {
      requestSlowSuite: () => h.scheduler.requestSlowSuite(),
      onNudge: () => h.scheduler.nudge(),
    });
    markStopWait({ store, worktreeId }, harness.name);
    h.write("src/math.ts", "export const add = (a: number, b: number) => a + b; // edited\n");
    await h.batch("src/math.ts");
  };
  /** Whether the slow tier's published activity is a wait for `reason`. */
  const waitsFor = (reason: SlowTierWait) => {
    const activity = readSlowActivity(store, worktreeId);
    return activity?.kind === "waiting" && activity.for === reason;
  };
  const underLoad = () =>
    readDaemonNotes(store, worktreeId).some((n) => n.text.includes("ran under load"));
  return { h, root, ran, turn, waitsFor, underLoad };
}

describe.each(HARNESSES)("Stop runs the slow tier it waits for, $name (019 D4.1)", (harness) => {
  it(
    "runs a lookup-only miss no trigger queues, and ends the turn silently once it passes (C4)",
    SLOW,
    async () => {
      const { h, root, ran, turn } = await fixture(harness, "lookup-only", 0);
      await turn();
      await h.scheduler.idle();
      // Not run and not queued: no pause runs it (`slow-off-line.test.ts`).
      expect(ran()).toBe(0);

      const started = performance.now();
      const out = await stopThenWait(harness, root);
      expect(out).toEqual({ quick: {}, waiting: {} });
      expect(ran()).toBe(1);
      expect(performance.now() - started).toBeLessThan(PROMPT_MS);
    },
  );

  it("runs a slow file the load guard holds at once, with no load note (C5)", SLOW, async () => {
    const { h, root, ran, turn, waitsFor, underLoad } = await fixture(
      harness,
      "lookup-then-run-missing",
      8,
    );
    // The start queued the slow file; with no consumer the pause trigger holds, and the guard waits.
    await waitFor(() => waitsFor("load"), 60_000);
    await turn();
    // The edit's fast run is done; the slow file waits for the agent's pause.
    await waitFor(() => waitsFor("idle"), 60_000);
    expect(ran()).toBe(0);

    const started = performance.now();
    const out = await stopThenWait(harness, root);
    expect(out).toEqual({ quick: {}, waiting: {} });
    expect(ran()).toBe(1);
    expect(performance.now() - started).toBeLessThan(PROMPT_MS);
    await h.scheduler.idle();
    expect(underLoad()).toBe(false);
  });
});
