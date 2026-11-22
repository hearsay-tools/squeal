import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { onTestFinished } from "vitest";
import { type AtDaemons, realDaemons } from "../../src/cli/status-at-daemons.js";
import { installCommitWorktree } from "../../src/core/checkout/commit-setup.js";
import type { InstallResult } from "../../src/core/checkout/install.js";
import { COMMIT_WORKTREES, type CommitWorktrees } from "../../src/core/daemon/commit-mode.js";
import { type RunningDaemon, startDaemon } from "../../src/core/daemon/daemon.js";
import type { AbsolutePath } from "../../src/core/types/common.js";
import { linkInstall } from "../commit/at-keys-fixture.js";
import { childEnv } from "../daemon/helpers.js";
import { keyedNow } from "./status-at-now-stand-in.js";

/*
 * Row 023-40c: a real commit daemon for a `status --at --run` test, in this
 * process, with the production commit worktree functions (its claim, its
 * whole-checkout check, its removal) and the fixture's linked install. The
 * working tree's side answers nothing and runs nothing. Each daemon stops
 * when the test ends.
 */

export interface RealCommitDaemon {
  readonly daemons: AtDaemons;
  /** The trees a commit daemon started in. */
  readonly started: AbsolutePath[];
}

export function realCommitDaemon(
  root: string,
  options: {
    /** The install in the commit worktree; the fixture's link by default. */
    readonly install?: (tree: AbsolutePath) => Promise<InstallResult>;
    /** Replaces commit worktree functions (a red control drops `check`). */
    readonly worktrees?: Partial<CommitWorktrees>;
  } = {},
): RealCommitDaemon {
  const runtime = realpathSync(mkdtempSync("/tmp/sq-at-"));
  const running: RunningDaemon[] = [];
  const started: AbsolutePath[] = [];
  onTestFinished(async () => {
    for (const daemon of running) await daemon.stop("stop-requested");
    rmSync(runtime, { recursive: true, force: true });
  });
  const link = options.install ?? linkInstall().install;
  const install = (tree: AbsolutePath) => installCommitWorktree(tree, { install: link });
  const real = realDaemons({
    start: async (tree) => {
      started.push(tree);
      const daemon = await startDaemon({
        root: tree,
        env: childEnv(runtime),
        commitWorktrees: { ...COMMIT_WORKTREES, install, ...options.worktrees },
      });
      if ("reason" in daemon) return daemon.message;
      running.push(daemon);
      let exited = false;
      void daemon.exited.then(() => {
        exited = true;
      });
      return { lives: async () => !exited };
    },
  });
  const daemons: AtDaemons = {
    ...real,
    worktree: async () => null,
    now: keyedNow,
    ask: async (at, group, paths, deadline, call) =>
      at === root ? "taken" : real.ask(at, group, paths, deadline, call),
    wait: async (at, files, deadline) => (at === root ? null : real.wait(at, files, deadline)),
  };
  return { daemons, started };
}
