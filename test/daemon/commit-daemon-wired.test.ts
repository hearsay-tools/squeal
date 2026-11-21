import { existsSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import {
  ensureCommitWorktree,
  readCommitWorktree,
} from "../../src/core/checkout/commit-worktree.js";
import { startDaemon } from "../../src/core/daemon/daemon.js";
import type { AbsolutePath } from "../../src/core/types/common.js";
import { countingInstall } from "../checkout/commit-fixture.js";
import { createFixtureRepo, SLOW } from "./helpers.js";

/*
 * Spec 023 D7.1 and D7.2, rows 023-38 and 023-39 together: with no
 * functions passed in, a daemon started in a real commit worktree finds
 * its marker, claims the worktree, and removes it when it stops.
 */

describe("a commit worktree's daemon, wired (spec 023 D7)", SLOW, () => {
  it("claims the worktree ensureCommitWorktree made and removes it at stop", async () => {
    const repo = createFixtureRepo();
    onTestFinished(repo.cleanup);
    const base = realpathSync(mkdtempSync(join(tmpdir(), "sq-commit-"))) as AbsolutePath;
    onTestFinished(() => rmSync(base, { recursive: true, force: true }));
    const installs: string[] = [];
    const made = await ensureCommitWorktree({
      root: repo.root as AbsolutePath,
      commit: "HEAD",
      cacheRoot: join(base, "cache") as AbsolutePath,
      install: countingInstall(installs),
      limit: 4,
    });
    expect(readCommitWorktree(made.tree)?.daemon).toBeUndefined();

    const daemon = await startDaemon({ root: made.tree, env: repo.env });
    if ("reason" in daemon) throw new Error(daemon.message);
    let stopped = false;
    onTestFinished(async () => {
      if (!stopped) await daemon.stop("stop-requested");
    });
    await daemon.ready;
    expect(readCommitWorktree(made.tree)?.daemon).toMatchObject({ pid: process.pid });

    stopped = true;
    await daemon.stop("stop-requested");
    expect(existsSync(made.tree)).toBe(false);
  });
});
