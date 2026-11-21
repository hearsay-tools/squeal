import { rmSync } from "node:fs";
import { describe, expect, it, onTestFinished } from "vitest";
import type { CommitWorktrees } from "../../src/core/daemon/commit-mode.js";
import { startDaemon } from "../../src/core/daemon/daemon.js";
import type { AbsolutePath } from "../../src/core/types/common.js";
import { createFixtureRepo, SLOW } from "./helpers.js";

/*
 * Review wave-22 S1 (spec 023 D6: "the report names them"): what the
 * commit worktree's removal reports, the processes the working-folder scan
 * ended and a removal error, reaches the daemon's log, which outlives its
 * store. The exit text says the worktree is removed only when it is gone.
 */

const ENDED = "squeal: ended pid 4242 (node server.js), its working folder was under the tree";
const FAILED = "squeal: could not remove the tree: EBUSY";

async function stopped(remove: CommitWorktrees["remove"]) {
  const repo = createFixtureRepo();
  onTestFinished(repo.cleanup);
  const log: string[] = [];
  const daemon = await startDaemon({
    root: repo.root,
    env: repo.env,
    log: (line) => void log.push(line),
    commitMode: true,
    commitWorktrees: { read: () => null, claim: () => {}, remove },
  });
  if ("reason" in daemon) throw new Error(daemon.message);
  await daemon.ready;
  const exit = await daemon.stop("stop-requested");
  return { exit, log };
}

describe("a commit daemon's worktree removal report (review wave-22 S1)", SLOW, () => {
  it("logs the processes removal ended and its error, and does not claim the worktree is removed", async () => {
    const { exit, log } = await stopped(async (_root, note) => {
      note?.(ENDED);
      note?.(FAILED);
    });
    expect(log).toEqual(expect.arrayContaining([ENDED, FAILED]));
    expect(exit.message).toContain("the commit worktree is not removed");
    expect(exit.message).not.toContain("the commit worktree is removed");
  });

  it("says the worktree is removed once it is gone", async () => {
    const { exit, log } = await stopped(async (root: AbsolutePath, note) => {
      note?.(ENDED);
      rmSync(root, { recursive: true, force: true });
    });
    expect(log).toContain(ENDED);
    expect(exit.message).toContain("the commit worktree is removed");
  });
});
