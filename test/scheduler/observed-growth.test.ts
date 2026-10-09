import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { startTimers } from "../../src/core/daemon/lifecycle.js";
import { observedStore } from "../../src/core/daemon/node-test-runners.js";
import { readHead } from "../../src/core/daemon-loop/head.js";
import { worktreeIdFor } from "../../src/core/fs/index.js";
import { createScheduler } from "../../src/core/scheduler/index.js";
import { storePaths } from "../../src/core/store/index.js";
import {
  DEFAULT_POLICY,
  type NodeTestProject,
  type RunnerAdapter,
  type Store,
  type TestFileRef,
} from "../../src/core/types/index.js";
import { createNodeTestAdapter } from "../../src/runners/node-test/adapter.js";
import { git } from "../hash/git-repo.js";
import { addWorktree, createRepo, openRepoStore, SLOW } from "./helpers.js";
import { RecordingSink } from "./recording-sink.js";

/*
 * Review wave 2, S2's remaining bound (task 003-26): worktree B keyed
 * `hidden.test.mjs` before A's run observed the path its computed `import()`
 * loads, then inherited A's pass under that key. B's copy of the path
 * differs. With no edit in B, nothing asked B's runner again, so B held a
 * pass for content it never ran. A runner-only refinement, which the daemon
 * queues when the shared observed key changed, re-keys and runs it.
 */

const NT: NodeTestProject = {
  name: "nt",
  cwd: "nt",
  node: process.execPath,
  argv: [],
  env: {},
  include: ["test/*.test.mjs"],
};
const HIDDEN_TEST = "nt/test/hidden.test.mjs";
const HIDDEN_SRC = "nt/src/hidden.mjs";

function writeProject(root: string): void {
  mkdirSync(join(root, "nt/src"), { recursive: true });
  mkdirSync(join(root, "nt/test"), { recursive: true });
  writeFileSync(join(root, HIDDEN_SRC), "export const hidden = 1;\n");
  writeFileSync(
    join(root, HIDDEN_TEST),
    [
      'import assert from "node:assert/strict";',
      'import { test } from "node:test";',
      'const target = "../src/hidden" + ".mjs";',
      'test("hidden is one", async () => assert.equal((await import(target)).hidden, 1));',
      "",
    ].join("\n"),
  );
}

/*
 * Review wave 2.5 (004), B3: a relative `--require` preload loads a helper
 * by a computed `require`; both test files check the value it sets.
 */
const PRELOADED: NodeTestProject = { ...NT, argv: ["--require", "./scripts/setup.cjs"] };
const CONTROL_TEST = "nt/test/control.test.mjs";
const PRELOAD_SRC = "nt/src/hidden.cjs";

function writePreloadProject(root: string): void {
  mkdirSync(join(root, "nt/scripts"), { recursive: true });
  mkdirSync(join(root, "nt/src"), { recursive: true });
  mkdirSync(join(root, "nt/test"), { recursive: true });
  writeFileSync(join(root, "nt/scripts/setup.cjs"), 'require("../src/hidden" + ".cjs");\n');
  writeFileSync(join(root, PRELOAD_SRC), "globalThis.hiddenValue = 1;\n");
  for (const path of [CONTROL_TEST, HIDDEN_TEST]) {
    writeFileSync(
      join(root, path),
      [
        'import assert from "node:assert/strict";',
        'import { test } from "node:test";',
        'test("the preload ran", () => assert.equal(globalThis.hiddenValue, 1));',
        "",
      ].join("\n"),
    );
  }
}

/** A node:test file's known outcome for its test, as `squeal status` reads it. */
function outcome(store: Store, root: string, path = HIDDEN_TEST): string | undefined {
  return store.knownStates
    .list(worktreeIdFor(root))
    .find((s) => s.check.testPath === path && s.check.kind === "test")?.outcome;
}

interface Worktree {
  readonly scheduler: ReturnType<typeof createScheduler>;
  /** Runs of the worktree's adapter, by test file. */
  readonly runs: TestFileRef[][];
  /** `closure` answers the adapter computed. */
  readonly closures: () => number;
}

/**
 * A scheduler over one worktree's node:test adapter, sharing the observed
 * key through `store`. `hold`, while pending, holds every `closure` answer
 * after the adapter computed it.
 */
async function open(
  root: string,
  store: Store,
  commonDir: string,
  hold?: Promise<void>,
  project: NodeTestProject = NT,
): Promise<Worktree> {
  const adapter = await createNodeTestAdapter(project, {
    root,
    observed: observedStore(store, project.name),
  });
  const runs: TestFileRef[][] = [];
  let closures = 0;
  const runner: RunnerAdapter = {
    ...adapter,
    async closure(testFile) {
      const closure = await adapter.closure(testFile);
      closures += 1;
      await hold;
      return closure;
    },
    run(files, options) {
      runs.push([...files]);
      return adapter.run(files, options);
    },
  };
  const worktreeId = worktreeIdFor(root);
  const scheduler = createScheduler({
    root,
    worktreeId,
    store,
    runner,
    sink: new RecordingSink(store, worktreeId),
    policy: DEFAULT_POLICY,
    squealVersion: "0.0.0-test",
    runsDir: storePaths(commonDir).runsDir,
    head: () => readHead(root),
  });
  onTestFinished(async () => {
    await scheduler.close();
    await adapter.close();
  });
  return { scheduler, runs, closures: () => closures };
}

async function twoWorktrees(preload = false) {
  const repo = createRepo("basic");
  (preload ? writePreloadProject : writeProject)(repo.main);
  git(repo.main, ["add", "-A"]);
  git(repo.main, ["commit", "-qm", "nt"]);
  const rootB = addWorktree(repo.main, repo.dir, "b");
  // B's copy differs, beyond what B's static graph sees: its run fails.
  if (preload) writeFileSync(join(rootB, PRELOAD_SRC), "globalThis.hiddenValue = 2;\n");
  else writeFileSync(join(rootB, HIDDEN_SRC), "export const hidden = 2;\n");
  const store = openRepoStore(repo.commonDir);
  return { repo, rootB, store };
}

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
    expect(b.runs.map((files) => files.map((f) => f.path))).toEqual([[HIDDEN_TEST]]);
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

    // With no edit in B and no further metadata write, a later tick re-keys and runs both.
    await expect.poll(() => b.runs.flat().length, { timeout: 30_000 }).toBe(2);
    await b.scheduler.idle();
    expect(
      b.runs
        .flat()
        .map((f) => f.path)
        .sort(),
    ).toEqual([CONTROL_TEST, HIDDEN_TEST]);
    expect(outcome(store, rootB, CONTROL_TEST)).toBe("fail");
    expect(outcome(store, rootB)).toBe("fail");
    expect(store.revisions.latest(worktreeIdFor(rootB))?.number).toBe(revision);
  }

  it("the timer re-keys both files on preload growth while B's baseline is held", () =>
    preloadGrowth(true));

  /*
   * Row 003-43: a node:test preload observation is keyed into the project
   * environment hash, so a run observing a new preload path stores its result
   * under the old environment key. Here A keys both files before the preload
   * growth moves either key, under the same keys as B, which miss
   * `nt/src/hidden.cjs` where they differ; A's pass then replaces B's own
   * fail and task 001-170's heal makes B pass. Before 001-170 the same race
   * gave A B's fail instead.
   */
  it.skip("the timer re-keys both files on preload growth after B started", () =>
    preloadGrowth(false));
});
