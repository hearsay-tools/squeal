import { describe, expect, it, onTestFinished } from "vitest";
import { startDaemon } from "../../src/core/daemon/daemon.js";
import { readMachines } from "../../src/core/runner-host/remote/machines-store.js";
import { pruneUser, type ReleaseBehaviour } from "../runner-host/remote/prune-fakes.js";
import { createFixtureRepo, SLOW, waitFor } from "./helpers.js";

/*
 * Row 026-37 (#301): a daemon's start releases, in the background, each
 * tracked remote machine whose worktree is gone, with no `squeal remote
 * prune`. The fixture repository has no remote lane; the machines are
 * another worktree's, reached through a fake provider.
 */

/** A real daemon of a fixture repository, started with the prune over `u`'s fake provider. */
async function started(u: ReturnType<typeof pruneUser>) {
  const repo = createFixtureRepo();
  onTestFinished(repo.cleanup);
  const logs: string[] = [];
  const daemon = await startDaemon({
    root: repo.root,
    env: {
      ...repo.env,
      XDG_CONFIG_HOME: u.env.XDG_CONFIG_HOME,
      XDG_STATE_HOME: u.env.XDG_STATE_HOME,
    },
    log: (line) => logs.push(line),
    remotePrune: { providerOf: u.providerOf },
  });
  if ("reason" in daemon) throw new Error(daemon.message);
  let stopped = false;
  onTestFinished(async () => {
    if (!stopped) await daemon.stop("stop-requested");
  });
  return {
    daemon,
    logs,
    stop: async () => {
      stopped = true;
      return daemon.stop("stop-requested");
    },
  };
}

const ids = (env: NodeJS.ProcessEnv) => readMachines(env).machines.map((m) => m.id);

function user(behaviour?: (id: string) => ReleaseBehaviour) {
  const u = pruneUser(behaviour);
  u.track({ id: "cmd:live" });
  u.track({ id: "cmd:old", worktreeRoot: u.gone() });
  return u;
}

describe("a daemon's start prunes the machines of removed worktrees (row 026-37)", SLOW, () => {
  it("releases a removed worktree's machine with worktree-removed and forgets it; a live one stays", async () => {
    const u = user();
    const d = await started(u);
    await waitFor(() => ids(u.env).length === 1, 30_000, "the removed worktree's record forgotten");
    expect(u.released).toEqual([["cmd:old", "worktree-removed"]]);
    expect(ids(u.env)).toEqual(["cmd:live"]);
    expect(d.logs).toContainEqual(
      expect.stringMatching(/^remote machine cmd:old \(command\) .* released$/),
    );
  });

  it("keeps the record of a release that fails, and logs it", async () => {
    const u = user(() => "fail");
    const d = await started(u);
    await waitFor(
      () => d.logs.some((l) => l.includes("not released")),
      30_000,
      "the failure logged",
    );
    expect(d.logs).toContainEqual(
      expect.stringMatching(
        /cmd:old .* not released, still tracked: HTTP 503 Service Unavailable$/,
      ),
    );
    expect(ids(u.env)).toEqual(["cmd:live", "cmd:old"]);
  });

  it("delays neither the start nor the exit while a release hangs, and the exit ends the prune", async () => {
    const u = user(() => "hang");
    const d = await started(u);
    await waitFor(() => u.released.length === 1, 30_000, "the release begun");
    await d.daemon.ready;
    const began = performance.now();
    const exit = await d.stop();
    expect(exit.code).toBe(0);
    // The exit waits for no release: a hanging one would hold it for good.
    expect(performance.now() - began).toBeLessThan(30_000);
    expect(ids(u.env)).toEqual(["cmd:live", "cmd:old"]);
    expect(d.logs.filter((l) => l.startsWith("remote machine"))).toEqual([]);
  });

  it("prunes nothing when the daemon is started without the prune", async () => {
    const u = user();
    const repo = createFixtureRepo();
    onTestFinished(repo.cleanup);
    const daemon = await startDaemon({
      root: repo.root,
      env: {
        ...repo.env,
        XDG_CONFIG_HOME: u.env.XDG_CONFIG_HOME,
        XDG_STATE_HOME: u.env.XDG_STATE_HOME,
      },
    });
    if ("reason" in daemon) throw new Error(daemon.message);
    await daemon.ready;
    await daemon.stop("stop-requested");
    expect(u.released).toEqual([]);
    expect(ids(u.env)).toEqual(["cmd:live", "cmd:old"]);
  });
});
