import { realpathSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { socketPathFor } from "../../src/core/daemon/paths.js";
import { worktreeIdFor } from "../../src/core/fs/index.js";
import { daemonExitMetaKey } from "../../src/core/types/index.js";
import { git } from "../hash/git-repo.js";
import {
  childEnv,
  daemonSuite,
  type FixtureRepo,
  SLOW,
  stopProcess,
  waitReady,
  withStore,
} from "./helpers.js";

/*
 * Review wave-13ah B1 (001-276): a daemon writes its `daemon-exit:` row only
 * once it has registered. A start that fails before, here on a socket
 * directory that cannot be made, leaves no row, so none outlives a removed
 * worktree that `store.prune` never visits. The control: a registered daemon's
 * stop still marks, and removal and prune take the row.
 */

const suite = daemonSuite();
const DAY_MS = 86_400_000;

/** A linked worktree of `repo`, never registered, whose daemons use `runtimeDir`. */
function linked(repo: FixtureRepo, runtimeDir: string): FixtureRepo {
  const path = join(dirname(repo.root), `linked-${Math.random().toString(36).slice(2)}`);
  git(repo.root, ["worktree", "add", "-q", "--detach", path]);
  const root = realpathSync(path);
  const worktreeId = worktreeIdFor(root);
  return {
    ...repo,
    root,
    worktreeId,
    runtimeDir,
    socketPath: socketPathFor(worktreeId, { XDG_RUNTIME_DIR: runtimeDir }),
    env: childEnv(runtimeDir),
  };
}

const read = (wt: FixtureRepo) =>
  withStore(wt, (store) => ({
    worktree: store.worktrees.get(wt.worktreeId),
    mark: store.meta.get(daemonExitMetaKey(wt.worktreeId)),
  }));

/** Removes the worktree's root, then prunes ten days on with seven days' retention. */
const removeAndPrune = (wt: FixtureRepo) => {
  rmSync(wt.root, { recursive: true, force: true });
  return withStore(wt, (store) =>
    store.prune({ now: Date.now() + 10 * DAY_MS, retentionDays: 7, maxSizeMb: null }),
  );
};

describe("the shutdown mark belongs to a registered daemon (review wave-13ah B1)", SLOW, () => {
  it("a start whose socket directory fails writes no row, before or after prune", async () => {
    const repo = suite.fixture();
    // A regular file where the socket directory goes: `prepareSocketDir` cannot make it.
    const runtimeFile = join(repo.runtimeDir, "not-a-dir");
    writeFileSync(runtimeFile, "");
    const wt = linked(repo, runtimeFile);
    const failed = suite.daemon(wt);
    expect(await failed.exited).toEqual({ code: 1, signal: null });
    expect(failed.stderr()).toContain("could not start serving");
    expect(read(wt)).toEqual({ worktree: null, mark: null });

    expect(removeAndPrune(wt).worktreesRemoved).toBe(0);
    expect(read(wt).mark).toBeNull();
  });

  it("a registered daemon's stop marks, and removal and prune take the row", async () => {
    const repo = suite.fixture();
    const wt = linked(repo, repo.runtimeDir);
    const daemon = suite.daemon(wt);
    await waitReady(wt, daemon);
    await stopProcess(daemon);
    expect(await daemon.exited).toEqual({ code: 0, signal: null });
    const stopped = read(wt);
    expect(stopped.worktree?.daemon).toBeNull();
    expect(stopped.mark).toMatch(/@\d+#/);

    expect(removeAndPrune(wt).worktreesRemoved).toBe(1);
    expect(read(wt)).toEqual({ worktree: null, mark: null });
  });
});
