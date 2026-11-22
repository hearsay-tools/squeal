import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { type AtDaemons, realDaemons } from "../../src/cli/status-at-daemons.js";
import { installCommitWorktree } from "../../src/core/checkout/commit-setup.js";
import type { InstallResult } from "../../src/core/checkout/install.js";
import { COMMIT_WORKTREES } from "../../src/core/daemon/commit-mode.js";
import { type RunningDaemon, startDaemon } from "../../src/core/daemon/daemon.js";
import type { AbsolutePath } from "../../src/core/types/common.js";
import { childEnv } from "../daemon/helpers.js";

/*
 * Row 023-42 (spec 023 D7.6): the commit daemons a proof's green side
 * reads and runs on, started in this process in the commit worktree the
 * proof made (no install), as `status-at-commit-daemon.test.ts` starts
 * them: each installs its worktree with the fixture's install, keys and
 * runs. `stop` stops each one, and its exit removes its worktree.
 */

export interface KitDaemons {
  readonly daemons: AtDaemons;
  /** The trees a commit daemon was started in, in order. */
  readonly started: readonly AbsolutePath[];
  /** Stops every daemon started here; each exit removes its commit worktree. */
  stop(): Promise<void>;
}

/** Real commit daemons in this process, installing with `install`. */
export function kitDaemons(install: (tree: AbsolutePath) => Promise<InstallResult>): KitDaemons {
  const runtime = realpathSync(mkdtempSync("/tmp/sq-proof-"));
  const started: AbsolutePath[] = [];
  const running: RunningDaemon[] = [];
  const daemons = realDaemons({
    start: async (tree) => {
      started.push(tree);
      const daemon = await startDaemon({
        root: tree,
        env: childEnv(runtime),
        commitWorktrees: {
          ...COMMIT_WORKTREES,
          install: (root: AbsolutePath) => installCommitWorktree(root, { install }),
        },
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
  return {
    daemons,
    started,
    async stop() {
      for (const daemon of running.splice(0)) await daemon.stop("stop-requested");
      rmSync(runtime, { recursive: true, force: true });
    },
  };
}
