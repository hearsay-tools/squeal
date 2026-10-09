import { describe, expect, it, onTestFinished } from "vitest";
import { startTimers } from "../../src/core/daemon/lifecycle.js";
import { worktreeIdFor } from "../../src/core/fs/index.js";
import { DEFAULT_POLICY } from "../../src/core/types/index.js";
import { SLOW } from "./helpers.js";
import {
  CONTROL_TEST,
  HIDDEN_TEST,
  keyOf,
  open,
  origin,
  outcome,
  PRELOADED,
  twoWorktrees,
} from "./preload-worktrees.js";

/*
 * Review wave 2, S2's remaining bound (task 003-26): worktree B keyed
 * `hidden.test.mjs` before A's run observed the path its computed `import()`
 * loads, then inherited A's pass under that key. B's copy of the path
 * differs. With no edit in B, nothing asked B's runner again, so B held a
 * pass for content it never ran. A runner-only refinement, which the daemon
 * queues when the shared observed key changed, re-keys and runs it.
 */

describe("scheduler: another worktree's observed growth (task 003-26)", SLOW, () => {
  it("re-keys and runs a file whose pass B inherited under a key lacking the observed path", async () => {
    const { repo, rootB, store } = await twoWorktrees();
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    onTestFinished(() => release());
    const a = await open(repo.main, store, repo.commonDir);
    const b = await open(rootB, store, repo.commonDir, held);

    // B keys the file from its static closure, then waits; A runs it and records the path.
    const bStarted = b.scheduler.start();
    await expect.poll(() => b.closures()).toBeGreaterThan(0);
    await a.scheduler.start();
    await a.scheduler.idle();
    expect(outcome(store, repo.main)).toBe("pass");
    release();
    await bStarted;
    await b.scheduler.idle();
    // The window S2 names: B holds A's pass for content it never ran.
    expect(b.runs).toEqual([]);
    expect(outcome(store, rootB)).toBe("pass");

    // With no edit in B, the runner-only refinement re-keys the file, which misses and runs.
    const revision = store.revisions.latest(worktreeIdFor(rootB))?.number;
    b.scheduler.refreshObserved();
    await b.scheduler.idle();
    // Its new fail is re-run once (task 001-171) and fails again.
    expect(b.runs.map((files) => files.map((f) => f.path))).toEqual([[HIDDEN_TEST], [HIDDEN_TEST]]);
    expect(outcome(store, rootB)).toBe("fail");
    // The revision is untouched: a runner-only refinement stores no revision.
    expect(store.revisions.latest(worktreeIdFor(rootB))?.number).toBe(revision);
  });

  it("runs nothing when the observed paths did not grow", async () => {
    const { repo, store } = await twoWorktrees();
    const a = await open(repo.main, store, repo.commonDir);
    await a.scheduler.start();
    await a.scheduler.idle();
    expect(a.runs).toHaveLength(1);
    a.scheduler.refreshObserved();
    await a.scheduler.idle();
    expect(a.runs).toHaveLength(1);
    expect(outcome(store, repo.main)).toBe("pass");
  });

  /*
   * Review wave 2.5 (004), B3: the daemon's timer acknowledged growth A
   * recorded while B's scheduler was still in its baseline, which took
   * nothing, so no later tick asked again. The timer here is the daemon's,
   * and its callback answers what the scheduler answers.
   */
  async function preloadGrowth(held: boolean): Promise<void> {
    const { repo, rootB, store } = await twoWorktrees(true);
    let release = () => {};
    const hold = held
      ? new Promise<void>((resolve) => {
          release = resolve;
        })
      : undefined;
    onTestFinished(() => release());
    const a = await open(repo.main, store, repo.commonDir, undefined, PRELOADED);
    const b = await open(rootB, store, repo.commonDir, hold, PRELOADED);
    // Nothing takes a refinement before the scheduler runs.
    expect(b.scheduler.refreshObserved()).toBe(false);
    let calls = 0;
    const hour = 60 * 60_000;
    const stop = startTimers({
      root: rootB,
      worktreeId: worktreeIdFor(rootB),
      commonDir: repo.commonDir,
      store,
      policy: { ...DEFAULT_POLICY, nodeTest: [PRELOADED] },
      now: Date.now,
      linkedDir: null,
      timings: {
        checkMs: hour,
        presenceMs: hour,
        pruneMs: hour,
        firstPruneMs: hour,
        observedMs: 50,
      },
      heartbeatMs: hour,
      presence: { since: Date.now(), lastPresentAt: null },
      lastActive: Date.now,
      active: () => {},
      observedChanged: () => {
        calls += 1;
        return b.scheduler.refreshObserved();
      },
      note: () => {},
      log: () => {},
      shutdown: () => {},
    });
    onTestFinished(stop);

    const bStarted = b.scheduler.start();
    if (held) await expect.poll(() => b.closures()).toBeGreaterThan(0);
    else await bStarted;
    const revision = store.revisions.latest(worktreeIdFor(rootB))?.number;
    await a.scheduler.start();
    await a.scheduler.idle();
    expect(outcome(store, repo.main)).toBe("pass");
    // The timer saw A's growth; while held, the scheduler could not take it.
    await expect.poll(() => calls).toBeGreaterThan(0);
    release();
    await bStarted;

    // With no edit in B and no further metadata write, B ends under keys with the path A's run
    // observed, where each new fail is re-run once (task 001-171) and fails again: 4 runs. When
    // B's first tier went under keys lacking the path, that run loaded it and stored nothing
    // (task 003-43): 6. Which one depends on whether the 003-26 timer re-keyed B before B's first
    // tier was selected, a race the test does not fix.
    await expect.poll(() => b.runs.flat().length, { timeout: 30_000 }).toBeGreaterThanOrEqual(4);
    await b.scheduler.idle();
    const ran = b.runs.flat().map((f) => f.path);
    expect([4, 6]).toContain(ran.length);
    expect(ran.filter((path) => path === HIDDEN_TEST)).toHaveLength(ran.length / 2);
    expect(outcome(store, rootB, CONTROL_TEST)).toBe("fail");
    expect(outcome(store, rootB)).toBe("fail");
    expect(store.revisions.latest(worktreeIdFor(rootB))?.number).toBe(revision);
  }

  it("the timer re-keys both files on preload growth while B's baseline is held", () =>
    preloadGrowth(true));

  it("the timer re-keys both files on preload growth after B started", () => preloadGrowth(false));

  /*
   * Row 003-43, 001 review wave 13i B2: a run that first observes a preload
   * path stores its result only under the environment key that holds the
   * path. A keys both files before B's run observes `nt/src/hidden.cjs`, where
   * the worktrees differ; A's pass under those keys must not stand for B.
   */
  it("a held worktree's pass never heals the fail of one that differs in an observed preload path", async () => {
    const { repo, rootB, store } = await twoWorktrees(true);
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    onTestFinished(() => release());
    const a = await open(repo.main, store, repo.commonDir, held, PRELOADED);
    const b = await open(rootB, store, repo.commonDir, undefined, PRELOADED);

    // A read its environment and computed a closure before any run observed the preload path.
    const aStarted = a.scheduler.start();
    await expect.poll(() => a.closures()).toBeGreaterThan(0);
    await b.scheduler.start();
    await b.scheduler.idle();
    expect(outcome(store, rootB)).toBe("fail");
    release();
    await aStarted;
    await a.scheduler.idle();

    expect(outcome(store, repo.main)).toBe("pass");
    expect(outcome(store, rootB)).toBe("fail");
    expect(origin(store, rootB)).toBe("own");
    expect(keyOf(store, repo.main)).not.toBe(keyOf(store, rootB));
  });

  it("stores a run's result only under the key whose environment holds the preload path it observed", async () => {
    const { repo, rootB, store } = await twoWorktrees(true);
    const b = await open(rootB, store, repo.commonDir, undefined, PRELOADED);
    await b.scheduler.start();
    await b.scheduler.idle();
    await b.scheduler.close();
    expect(outcome(store, rootB)).toBe("fail");
    const runs = b.runs.length;

    // B reopened keys with the observed path, and finds its own fail there without a run.
    const again = await open(rootB, store, repo.commonDir, undefined, PRELOADED);
    await again.scheduler.start();
    await again.scheduler.idle();
    expect(again.runs).toEqual([]);
    const keyB = keyOf(store, rootB);
    const stored = store.results
      .byKey(keyB ?? null, 0)
      .filter((r) => r.check.testPath === HIDDEN_TEST && r.check.kind === "test");
    expect(stored.map((r) => r.outcome)).toEqual(["fail"]);
    expect(runs).toBeGreaterThan(0);

    // A, keyed with its own copy of the path, gets a different key and runs.
    const a = await open(repo.main, store, repo.commonDir, undefined, PRELOADED);
    await a.scheduler.start();
    await a.scheduler.idle();
    expect(keyOf(store, repo.main)).not.toBe(keyB);
    expect(a.runs.flat().map((f) => f.path)).toContain(HIDDEN_TEST);
    expect(outcome(store, repo.main)).toBe("pass");
    expect(outcome(store, rootB)).toBe("fail");
  });
});
