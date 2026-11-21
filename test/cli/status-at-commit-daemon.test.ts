import { existsSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { describe, expect, it, onTestFinished } from "vitest";
import { type AtDaemons, realDaemons } from "../../src/cli/status-at-daemons.js";
import { readCommitWorktree } from "../../src/core/checkout/commit-worktree.js";
import { type RunningDaemon, startDaemon } from "../../src/core/daemon/daemon.js";
import type { AbsolutePath } from "../../src/core/types/common.js";
import { fixture, git, linkInstall, ref } from "../commit/at-keys-fixture.js";
import { childEnv, SLOW } from "../daemon/helpers.js";
import { run, testOf } from "./status-at-kit.js";

/*
 * Row 023-40a (spec 023 D7.1 to D7.4) with a real commit daemon, started
 * in this process in the commit worktree `ensureCommitWorktree` made: the
 * call keeps it alive until the daemon claims the worktree, queues the
 * named file there, and reads the result the daemon stored at D2's keys,
 * the keys the call computed in its temporary checkout. A second caller
 * reuses the worktree and its daemon. With the ceiling full, a new commit
 * waits for a place and says so on stderr. The working tree's side is a
 * stand-in here: this file is about the commit daemon.
 */

const A = ref("test/a.test.ts");
const B = ref("test/b.test.ts");

/** The real commit side; the working tree's side answers nothing and runs nothing. */
function commitOnly(root: string, started: AbsolutePath[], daemons: RunningDaemon[]): AtDaemons {
  const runtime = realpathSync(mkdtempSync("/tmp/sq-at-"));
  onTestFinished(() => rmSync(runtime, { recursive: true, force: true }));
  const real = realDaemons(async (tree) => {
    started.push(tree);
    const daemon = await startDaemon({ root: tree, env: childEnv(runtime) });
    if ("reason" in daemon) return daemon.message;
    daemons.push(daemon);
    await daemon.ready;
    return null;
  });
  return {
    ...real,
    worktree: async () => null,
    ask: async (at, group, paths, deadline, call) =>
      at === root ? "taken" : real.ask(at, group, paths, deadline, call),
    wait: async (at, files, deadline) => (at === root ? null : real.wait(at, files, deadline)),
  };
}

type Side = { state: string; origin?: { kind: string } };
const atOf = (out: string, path: string) =>
  (JSON.parse(out).files as { path: string; at: Side }[]).find((x) => x.path === path)?.at;

describe("status --at --run on a real commit daemon (row 023-40, D7)", SLOW, () => {
  it("queues there, reads its result at D2's keys, and a second caller reuses it", {
    timeout: 300_000,
  }, async () => {
    const f = fixture({
      "squeal.config.json": `${JSON.stringify({ daemon: { maxCommitDaemons: 1 } })}\n`,
      "src/a.ts": "export const value = 1;\n",
      [A.path]: testOf("a", 1),
      [B.path]: testOf("a", 1),
    });
    const a = git(f.root, "rev-parse", "HEAD").trim();
    const b = f.commit({ "src/a.ts": "export const value = 2;\n" });
    f.commit({ "src/a.ts": "export const value = 3;\n" });
    const started: AbsolutePath[] = [];
    const daemons: RunningDaemon[] = [];
    onTestFinished(async () => {
      for (const daemon of daemons) await daemon.stop("stop-requested");
    });
    const options = {
      cacheRoot: f.cacheRoot,
      install: linkInstall().install,
      daemons: commitOnly(f.root, started, daemons),
      placeWaitMs: 1500,
    };
    const run1 = { allMissing: false };

    // The test at A fails at HEAD's value; at A it passes, and only the commit daemon ran it.
    const first = await run(
      f,
      { commit: a, paths: [A.path], json: true, run: run1, waitMs: Infinity },
      options,
    );
    expect(first.code, first.err).toBe(3);
    expect(atOf(first.out, A.path)).toMatchObject({ state: "pass", origin: { kind: "commit" } });
    expect(started).toHaveLength(1);
    const tree = started[0] as AbsolutePath;
    expect(readCommitWorktree(tree)?.daemon?.pid).toBe(process.pid);
    expect(JSON.parse(first.out).run).toMatchObject({
      commit: { files: 1, known: 1, running: 0, tree },
      again: null,
    });

    // A second caller at the same commit: the same worktree and daemon, nothing started.
    const second = await run(
      f,
      { commit: a, paths: [B.path], json: true, run: run1, waitMs: Infinity },
      options,
    );
    expect(atOf(second.out, B.path)).toMatchObject({ state: "pass", origin: { kind: "commit" } });
    expect(started).toEqual([tree]);
    expect(JSON.parse(second.out).run.commit.tree).toBe(tree);

    // The ceiling (1) is full: a new commit waits for a place, says so, and gives up here.
    const third = await run(f, { commit: b, paths: [A.path], run: run1, waitMs: 5000 }, options);
    expect(third.err).toContain("squeal: waiting for a place: 1 of 1 commit worktrees live");
    expect(third.out).toContain(
      `--run: 1 test files with no result at ${b.slice(0, 9)} not queued: the commit worktree could not be made`,
    );
    expect(started).toEqual([tree]);

    for (const daemon of daemons.splice(0)) await daemon.stop("stop-requested");
    expect(existsSync(tree)).toBe(false);
    expect(f.checkouts()).toEqual([]);
  });
});
