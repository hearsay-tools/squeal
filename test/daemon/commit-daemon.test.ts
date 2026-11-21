import { appendFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { codeStorePath } from "../../src/core/code/store/open.js";
import type { CommitWorktrees } from "../../src/core/daemon/commit-mode.js";
import { startDaemon } from "../../src/core/daemon/daemon.js";
import { lintStorePath } from "../../src/core/lint/store/open.js";
import type { AbsolutePath } from "../../src/core/types/common.js";
import { FakeProvider } from "../lint/pass/helpers.js";
import { createFixtureRepo, delay, ping, SLOW, withStore } from "./helpers.js";

/*
 * Spec 023 D7.2 (row 023-39): a daemon in a commit worktree, started in
 * process on the scheduler fixture. Its config asks for everything a commit
 * daemon must not do: a start that runs missing files, lint and complexity.
 * 023-38's commit worktree functions are a fake behind the seam.
 */

const CONFIG = {
  baseline: { onStart: "lookup-then-run-missing" },
  lint: { enabled: true },
  complexity: { enabled: true },
  coverage: { enabled: false },
};

/** A fake of 023-38's functions that names `root` a commit worktree and records the calls. */
function fakeWorktrees(root: string) {
  const calls: string[] = [];
  const worktrees: CommitWorktrees = {
    read: (at) => (at === root ? { commit: "fixture" } : null),
    claim: (at: AbsolutePath) => void calls.push(`claim ${at}`),
    remove: async (at: AbsolutePath) => {
      // Its socket is closed by then; its lock is still held (`#shutdown`).
      calls.push(`remove ${at}`);
    },
  };
  return { calls, worktrees };
}

const latest = (repo: { commonDir: string; worktreeId: string; root: string }) =>
  withStore(repo as never, (store) => store.revisions.latest(repo.worktreeId)?.number ?? 0);

describe("a commit worktree's daemon (spec 023 D7.2)", SLOW, () => {
  it("starts lookup-only, lints nothing, counts nothing, watches no edits, and removes its worktree at exit", async () => {
    const repo = createFixtureRepo({
      files: { "squeal.config.json": `${JSON.stringify(CONFIG)}\n` },
    });
    onTestFinished(repo.cleanup);
    const provider = new FakeProvider();
    provider.extensions.add(".ts");
    let lintMade = 0;
    const { calls, worktrees } = fakeWorktrees(repo.root);
    const daemon = await startDaemon({
      root: repo.root,
      env: repo.env,
      lintProviders: {
        eslint: () => {
          lintMade += 1;
          return provider;
        },
      },
      commitWorktrees: worktrees,
    });
    if ("reason" in daemon) throw new Error(daemon.message);
    let stopped = false;
    onTestFinished(async () => {
      if (!stopped) await daemon.stop("stop-requested");
    });
    await daemon.ready;
    // Claimed once its lock is held, so the sweep sees a live owner.
    expect(calls).toEqual([`claim ${repo.root}`]);
    const revision = latest(repo);

    // An edit: a worktree daemon stores a revision within a second; this one watches nothing.
    appendFileSync(join(repo.root, "src/math.ts"), "\nexport const edited = 1;\n");
    await delay(3_000);
    expect(latest(repo)).toBe(revision);
    // Lookup-only: none of the five test files ran, though the config asks for missing runs.
    const rows = withStore(repo, (store) =>
      store.testFileKeys
        .list(repo.worktreeId)
        .map((row) => ({ key: row.key, results: store.results.byKey(row.key).length })),
    );
    expect(rows.filter((row) => row.key !== null)).toHaveLength(5);
    expect(rows.map((row) => row.results)).toEqual([0, 0, 0, 0, 0]);
    // No lint pass and no complexity count, so neither store exists.
    expect(lintMade).toBe(0);
    expect(existsSync(lintStorePath(repo.commonDir))).toBe(false);
    expect(existsSync(codeStorePath(repo.commonDir))).toBe(false);
    // It serves as every daemon does.
    expect(await ping(repo.socketPath, 2_000)).not.toBeNull();

    stopped = true;
    const exit = await daemon.stop("stop-requested");
    expect(exit.reason).toBe("stop-requested");
    expect(calls).toEqual([`claim ${repo.root}`, `remove ${repo.root}`]);
  });

  it("a worktree's own daemon claims and removes nothing", async () => {
    const repo = createFixtureRepo();
    onTestFinished(repo.cleanup);
    const { calls, worktrees } = fakeWorktrees(`${repo.root}-other`);
    const daemon = await startDaemon({
      root: repo.root,
      env: repo.env,
      commitWorktrees: worktrees,
    });
    if ("reason" in daemon) throw new Error(daemon.message);
    await daemon.ready;
    await daemon.stop("stop-requested");
    expect(calls).toEqual([]);
  });
});
