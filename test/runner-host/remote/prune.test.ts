import { describe, expect, it } from "vitest";
import { readMachines } from "../../../src/core/runner-host/remote/machines-store.js";
import { pruneRemovedWorktrees } from "../../../src/core/runner-host/remote/prune.js";
import { pruneUser } from "./prune-fakes.js";

/*
 * Row 026-37 (#301, spec 026 D12.5): the one prune `squeal remote prune`
 * and each daemon's start run. A fake provider records each release.
 */

const ids = (env: NodeJS.ProcessEnv) => readMachines(env).machines.map((m) => m.id);

describe("pruneRemovedWorktrees (row 026-37)", () => {
  it("releases each machine of a removed worktree with worktree-removed and forgets it", async () => {
    const u = pruneUser();
    u.track({ id: "cmd:live" });
    u.track({ id: "cmd:old", worktreeRoot: u.gone() });
    const result = await pruneRemovedWorktrees({ env: u.env, providerOf: u.providerOf });
    expect(result).toMatchObject({ gone: 1, aborted: false });
    expect(result.outcomes.map((o) => [o.kind, o.record.id])).toEqual([["released", "cmd:old"]]);
    expect(u.released).toEqual([["cmd:old", "worktree-removed"]]);
    expect(ids(u.env)).toEqual(["cmd:live"]);
  });

  it("keeps a machine whose release fails, and says why", async () => {
    const u = pruneUser(() => "fail");
    u.track({ id: "cmd:old", worktreeRoot: u.gone() });
    const result = await pruneRemovedWorktrees({ env: u.env, providerOf: u.providerOf });
    expect(result.outcomes).toMatchObject([
      { kind: "failed", error: "HTTP 503 Service Unavailable" },
    ]);
    expect(ids(u.env)).toEqual(["cmd:old"]);
  });

  it("releases nothing in a dry run", async () => {
    const u = pruneUser();
    u.track({ id: "cmd:old", worktreeRoot: u.gone() });
    const result = await pruneRemovedWorktrees({
      env: u.env,
      dryRun: true,
      providerOf: u.providerOf,
    });
    expect(result.outcomes.map((o) => o.kind)).toEqual(["would-release"]);
    expect(u.released).toEqual([]);
    expect(ids(u.env)).toEqual(["cmd:old"]);
  });

  it("ends at the abort with a release in flight, and keeps its record for the next prune", async () => {
    const u = pruneUser((id) => (id === "cmd:a" ? "hang" : "ok"));
    u.track({ id: "cmd:a", worktreeRoot: u.gone() });
    u.track({ id: "cmd:b", worktreeRoot: u.gone() });
    const stop = new AbortController();
    const pruning = pruneRemovedWorktrees({
      env: u.env,
      providerOf: u.providerOf,
      signal: stop.signal,
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    stop.abort();
    const result = await pruning;
    expect(result).toMatchObject({ gone: 2, outcomes: [], aborted: true });
    expect(u.released).toEqual([["cmd:a", "worktree-removed"]]);
    expect(ids(u.env)).toEqual(["cmd:a", "cmd:b"]);
  });

  it("is safe when two prunes run at once: each machine ends released and forgotten", async () => {
    const u = pruneUser();
    u.track({ id: "cmd:a", worktreeRoot: u.gone() });
    u.track({ id: "cmd:b", worktreeRoot: u.gone() });
    const both = await Promise.all([
      pruneRemovedWorktrees({ env: u.env, providerOf: u.providerOf }),
      pruneRemovedWorktrees({ env: u.env, providerOf: u.providerOf }),
    ]);
    // A machine already deleted is released all the same (agent37 answers 404, a resolved release).
    for (const result of both)
      expect(result.outcomes.every((o) => o.kind === "released")).toBe(true);
    expect(ids(u.env)).toEqual([]);
  });
});
