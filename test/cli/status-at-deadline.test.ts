import { spawn } from "node:child_process";
import { dirname } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { type AtDaemons, realDaemons } from "../../src/cli/status-at-daemons.js";
import { RECORD_WAIT_MS } from "../../src/cli/status-at-queue.js";
import type { Started } from "../../src/cli/status-at-start.js";
import {
  ensureCommitWorktree,
  removeCommitWorktree,
} from "../../src/core/checkout/commit-worktree.js";
import { readMarker } from "../../src/core/checkout/marker.js";
import { sweepCheckouts } from "../../src/core/checkout/sweep.js";
import { resolveCommonDir } from "../../src/core/fs/git-layout.js";
import type { AbsolutePath } from "../../src/core/types/common.js";
import { type Fixture, fixture, git, linkInstall, ref } from "../commit/at-keys-fixture.js";
import { SLOW } from "../scheduler/cleanup.js";
import { run, standIn, standInTree, testOf } from "./status-at-kit.js";
import { keyedNow } from "./status-at-now-stand-in.js";

/*
 * Review wave-23 B1 and its re-review (spec 023 D7.3 as amended, row
 * 023-40c): one bound for the whole `status --at --run` call. With the
 * real `ensureCommitWorktree` (no install) and its production place wait
 * (10 minutes), a full ceiling ends at the call's bound with no worktree
 * made; a commit daemon that exits before it answers ends the start's wait
 * at once; one that lives and never answers ends it at the bound, and owns
 * the worktree from its spawn, so the sweep keeps the worktree while it
 * lives; and the requests of several groups share one bound, so a group
 * past it is not asked. Only the daemons' start is a stand-in.
 */

const A = ref("test/a.test.ts");
const B = ref("test/b.test.ts");
const run1 = { allMissing: false };
/** What a call may take past its bound: the report, a socket's last read, a busy host. */
const ALLOWANCE_MS = 6_000;

/** Three commits that change `src/a.ts`; the call's limit is one commit worktree. */
function commits(): { f: Fixture; a: string; b: string } {
  const f = fixture({
    "squeal.config.json": `${JSON.stringify({ daemon: { maxCommitDaemons: 1 } })}\n`,
    "src/a.ts": "export const value = 1;\n",
    [A.path]: testOf("a", 1),
  });
  const a = git(f.root, "rev-parse", "HEAD").trim();
  const b = f.commit({ "src/a.ts": "export const value = 2;\n" });
  f.commit({ "src/a.ts": "export const value = 3;\n" });
  return { f, a, b };
}

/** The real commit side with `start` in place of a daemon; the working tree's side asks nothing. */
function commitSide(root: string, start: (tree: AbsolutePath) => Promise<Started | string>) {
  const trees: AbsolutePath[] = [];
  const real = realDaemons({
    start: async (tree) => {
      trees.push(tree);
      onTestFinished(async () => {
        await removeCommitWorktree(tree);
      });
      return start(tree);
    },
  });
  const daemons: AtDaemons = {
    ...real,
    worktree: async () => null,
    now: keyedNow,
    ask: async (at, group, paths, bound, call) =>
      at === root ? "taken" : real.ask(at, group, paths, bound, call),
    wait: async () => null,
  };
  return { daemons, trees };
}

const timed = async <T>(work: () => Promise<T>) => {
  const began = Date.now();
  const value = await work();
  return { value, ms: Date.now() - began };
};

describe("status --at --run ends by one bound (review wave-23 B1, row 023-40c)", SLOW, () => {
  it("gives up a full ceiling's place wait at the call's bound, with no worktree made", {
    timeout: 120_000,
  }, async () => {
    const { f, a, b } = commits();
    const install = linkInstall().install;
    // The one place is taken: a live commit worktree at A, owned by this process.
    const held = await ensureCommitWorktree({
      root: f.root,
      commit: a,
      cacheRoot: f.cacheRoot,
      install,
      limit: 1,
    });
    onTestFinished(async () => {
      await removeCommitWorktree(held.tree);
    });
    const side = commitSide(f.root, async () => "no start in this test");
    const options = { cacheRoot: f.cacheRoot, install, daemons: side.daemons };

    const { value: called, ms } = await timed(() =>
      run(f, { commit: b, paths: [A.path], run: run1, waitMs: 3000 }, options),
    );
    expect(called.err).toContain("squeal: waiting for a place: 1 of 1 commit worktrees live");
    expect(called.out).toContain(
      `--run: nothing queued at ${b.slice(0, 9)}: the call's wait ended before a commit worktree was free (waiting for a place: 1 of 1 commit worktrees live (${a.slice(0, 12)}))`,
    );
    // The production place wait is 10 minutes; the call ended with its asks' bound.
    expect(ms).toBeLessThan(RECORD_WAIT_MS + ALLOWANCE_MS);
    expect(side.trees).toEqual([]);
    expect(f.checkouts()).toEqual([held.folder]);
  });

  it("stops waiting for the commit daemon when it exits before it answers", {
    timeout: 45_000,
  }, async () => {
    const { f, a } = commits();
    const side = commitSide(f.root, async () => ({ lives: async () => false }));
    const options = {
      cacheRoot: f.cacheRoot,
      install: linkInstall().install,
      daemons: side.daemons,
    };

    // A bare `--wait`: before review wave-23 the claim wait alone took 60 s.
    const { value: called, ms } = await timed(() =>
      run(f, { commit: a, paths: [A.path], run: run1, waitMs: Infinity }, options),
    );
    expect(side.trees).toHaveLength(1);
    expect(called.out).toContain(
      `--run: nothing queued at ${a.slice(0, 9)}: the commit daemon exited before it served ${side.trees[0]}`,
    );
    expect(ms).toBeLessThan(30_000);
  });

  it("ends the wait for a live daemon that never answers at the bound; that daemon owns the worktree", {
    timeout: 90_000,
  }, async () => {
    const { f, a } = commits();
    // A real process stands for a daemon that is still starting: it lives and never answers.
    const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      stdio: "ignore",
    });
    onTestFinished(() => {
      child.kill("SIGKILL");
    });
    const pid = child.pid as number;
    const side = commitSide(f.root, async () => ({
      pid,
      lives: async () => child.exitCode === null && child.signalCode === null,
    }));
    const options = {
      cacheRoot: f.cacheRoot,
      install: linkInstall().install,
      daemons: side.daemons,
    };

    const { value: called, ms } = await timed(() =>
      run(f, { commit: a, paths: [A.path], run: run1, waitMs: 1000 }, options),
    );
    const tree = side.trees[0] as AbsolutePath;
    expect(called.out).toContain(
      `nothing queued at ${a.slice(0, 9)}: the call's wait ended before the commit daemon in ${tree} answered (starting)`,
    );
    expect(called.out).toContain(`squeal status --at ${a} ${A.path} --run queues them again`);
    expect(ms).toBeLessThan(RECORD_WAIT_MS + ALLOWANCE_MS);

    // Review wave-23 re-review: the spawned process owns the worktree, not the call.
    const folder = dirname(tree) as AbsolutePath;
    expect(readMarker(folder)?.owner.pid).toBe(pid);
    const commonDir = resolveCommonDir(f.root as AbsolutePath) as AbsolutePath;
    const dirs = [dirname(folder) as AbsolutePath];
    await sweepCheckouts({ commonDir, dirs });
    expect(f.checkouts()).toEqual([folder]);
    // Once it is gone, the sweep removes the worktree.
    const gone = new Promise((done) => child.once("exit", done));
    child.kill("SIGKILL");
    await gone;
    await sweepCheckouts({ commonDir, dirs });
    expect(f.checkouts()).toEqual([]);
  });

  it("shares one bound across the working tree's groups; a group past it is not asked", {
    timeout: 60_000,
  }, async () => {
    // The working tree's policy puts B in a group of its own.
    const f = fixture({
      "squeal.config.json": `${JSON.stringify({ slow: { include: [B.path] } })}\n`,
      "src/a.ts": "export const value = 1;\n",
      [A.path]: testOf("a", 1),
      [B.path]: testOf("a", 1),
    });
    const a = git(f.root, "rev-parse", "HEAD").trim();
    f.commit({ "src/a.ts": "export const value = 2;\n" });
    const tree = standInTree(f);
    const ports = standIn(tree, () => undefined, { select: () => [] }).ports;
    const bounds: { root: string; group: string; bound: number }[] = [];
    const daemons: AtDaemons = {
      ...ports,
      async ask(root, group, paths, bound, call) {
        bounds.push({ root, group, bound });
        // The first request takes until the bound: the next group is past it.
        while (Date.now() < bound) await new Promise((done) => setTimeout(done, 50));
        return ports.ask(root, group, paths, bound, call);
      },
    };
    const options = { cacheRoot: f.cacheRoot, install: linkInstall().install, daemons };

    const { value: called, ms } = await timed(() =>
      run(
        f,
        { commit: a, paths: ["test"], run: { allMissing: true }, waitMs: 0, json: true },
        options,
      ),
    );
    expect(bounds).toHaveLength(1);
    const problem = JSON.parse(called.out).run.now.problem as string;
    expect(problem).toMatch(/^group .+: not asked: the call's wait ended$/);
    expect(problem).not.toContain(`group ${bounds[0]?.group}:`);
    expect(ms).toBeLessThan(RECORD_WAIT_MS + ALLOWANCE_MS);
  });
});
