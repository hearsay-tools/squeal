import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { type AtDaemons, realDaemons } from "../../src/cli/status-at-daemons.js";
import { RECORD_WAIT_MS } from "../../src/cli/status-at-queue.js";
import { CLAIM_GRACE_MS, type Started } from "../../src/cli/status-at-start.js";
import {
  ensureCommitWorktree,
  removeCommitWorktree,
} from "../../src/core/checkout/commit-worktree.js";
import type { AbsolutePath } from "../../src/core/types/common.js";
import { type Fixture, fixture, git, linkInstall, ref } from "../commit/at-keys-fixture.js";
import { SLOW } from "../scheduler/cleanup.js";
import { run, standIn, standInTree, testOf } from "./status-at-kit.js";

/*
 * Review wave-23 B1 (spec 023 D7.3, research `run-wait-model.md` Q7): one
 * deadline for the whole `status --at --run` call. With the real
 * `ensureCommitWorktree` and its production place wait (10 minutes), a
 * full ceiling ends at the call's wait with no worktree made; a commit
 * daemon that exits before its claim ends the claim wait at once; one that
 * lives and never claims ends it `CLAIM_GRACE_MS` after the call's
 * requests; and the requests of several groups share one bound, so a
 * group past it is not asked. Only the daemons' start is a stand-in.
 */

const A = ref("test/a.test.ts");
const B = ref("test/b.test.ts");
const run1 = { allMissing: false };

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
  const real = realDaemons(async (tree) => {
    trees.push(tree);
    onTestFinished(async () => {
      await removeCommitWorktree(tree);
    });
    return start(tree);
  });
  const daemons: AtDaemons = {
    ...real,
    worktree: async () => null,
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

describe("status --at --run ends by one deadline (review wave-23 B1)", SLOW, () => {
  it("gives up a full ceiling's place wait at the call's wait, with no worktree made", {
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
    const waitMs = 3000;

    const { value: called, ms } = await timed(() =>
      run(f, { commit: b, paths: [A.path], run: run1, waitMs }, options),
    );
    expect(called.err).toContain("squeal: waiting for a place: 1 of 1 commit worktrees live");
    expect(called.out).toContain(
      `--run: 1 test files with no result at ${b.slice(0, 9)} not queued: the call's wait ended before a commit worktree was free (waiting for a place: 1 of 1 commit worktrees live (${a.slice(0, 12)}))`,
    );
    // The production place wait is 10 minutes; the call ended with its requests' bound.
    expect(ms).toBeLessThan(waitMs + RECORD_WAIT_MS + 10_000);
    expect(side.trees).toEqual([]);
    expect(f.checkouts()).toEqual([held.folder]);
  });

  it("stops waiting for the claim when the commit daemon exits before it", {
    timeout: 45_000,
  }, async () => {
    const { f, a } = commits();
    const side = commitSide(f.root, async () => ({ lives: async () => false }));
    const options = {
      cacheRoot: f.cacheRoot,
      install: linkInstall().install,
      daemons: side.daemons,
    };

    // A bare `--wait`: before the repair the claim wait alone took 60 s.
    const { value: called, ms } = await timed(() =>
      run(f, { commit: a, paths: [A.path], run: run1, waitMs: Infinity }, options),
    );
    expect(side.trees).toHaveLength(1);
    expect(called.out).toContain(
      `not queued: the commit daemon exited before it claimed ${side.trees[0]}`,
    );
    expect(ms).toBeLessThan(30_000);
  });

  it("ends the claim wait of a live daemon that never claims, past the call's requests", {
    timeout: 90_000,
  }, async () => {
    const { f, a } = commits();
    const side = commitSide(f.root, async () => ({ lives: async () => true }));
    const options = {
      cacheRoot: f.cacheRoot,
      install: linkInstall().install,
      daemons: side.daemons,
    };
    const waitMs = 1000;

    const { value: called, ms } = await timed(() =>
      run(f, { commit: a, paths: [A.path], run: run1, waitMs }, options),
    );
    expect(called.out).toContain(
      `not queued: the call's wait ended before the commit daemon claimed ${side.trees[0]} (starting)`,
    );
    expect(called.out).toContain(`squeal status --at ${a} ${A.path} --run queues them again`);
    expect(ms).toBeLessThan(waitMs + RECORD_WAIT_MS + CLAIM_GRACE_MS + 10_000);
  });

  it("shares one request bound across groups and sides; a group past it is not asked", {
    timeout: 60_000,
  }, async () => {
    const f = fixture({
      "squeal.config.json": "{}\n",
      "src/a.ts": "export const value = 1;\n",
      [A.path]: testOf("a", 1),
      [B.path]: testOf("a", 1),
    });
    const a = git(f.root, "rev-parse", "HEAD").trim();
    f.commit({ "src/a.ts": "export const value = 2;\n" });
    const tree = standInTree(f);
    // The commit worktree's policy puts B in a group of its own.
    writeFileSync(
      join(tree, "squeal.config.json"),
      `${JSON.stringify({ slow: { include: [B.path] } })}\n`,
    );
    const ports = standIn(tree, () => undefined).ports;
    const bounds: { root: string; group: string; bound: number }[] = [];
    const daemons: AtDaemons = {
      ...ports,
      async ask(root, group, paths, bound, call) {
        bounds.push({ root, group, bound });
        // The commit daemon's first request takes until the bound: the next group is past it.
        if (root === tree)
          while (Date.now() < bound) await new Promise((done) => setTimeout(done, 50));
        return ports.ask(root, group, paths, bound, call);
      },
    };
    const options = { cacheRoot: f.cacheRoot, install: linkInstall().install, daemons };

    const called = await run(
      f,
      { commit: a, paths: ["test"], run: { allMissing: true }, waitMs: 0, json: true },
      options,
    );
    const atTree = bounds.filter((ask) => ask.root === tree);
    expect(atTree).toHaveLength(1);
    expect(new Set(bounds.map((ask) => ask.bound)).size).toBe(1);
    const problem = JSON.parse(called.out).run.commit.problem as string;
    expect(problem).toMatch(/^group .+: not asked: the call's wait ended$/);
    expect(problem).not.toContain(`group ${atTree[0]?.group}:`);
  });
});
