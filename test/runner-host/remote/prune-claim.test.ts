import { execFile, execFileSync } from "node:child_process";
import { chmodSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it, onTestFinished } from "vitest";
import { worktreeIdFor } from "../../../src/core/fs/git-layout.js";
import { readMachines } from "../../../src/core/runner-host/remote/machines-store.js";
import { machineScope } from "../../../src/core/runner-host/remote/presence.js";
import { pruneRemovedWorktrees } from "../../../src/core/runner-host/remote/prune.js";
import type { AbsolutePath } from "../../../src/core/types/common.js";
import { pruneUser, type ReleaseBehaviour } from "./prune-fakes.js";

/*
 * Row 026-43, review 0.1.667 B1, B2 and N1: the prune of unused machines
 * with the real daemon liveness reader, and a daemon of the worktree run
 * as its own process (`prune-daemon-entry.ts`) that writes a fresh
 * heartbeat into the worktree's real store, or claims the machine record
 * as a daemon does before it reuses the machine.
 */

const TSX = pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href;
const DAEMON = resolve(import.meta.dirname, "prune-daemon-entry.ts");
const run = promisify(execFile);
const HOUR = 3_600_000;
const ago = (hours: number) => Date.now() - hours * HOUR;

/** A prune user whose live worktree is a Git repository, so its daemon has a store to be read. */
function repoUser(behaviour?: (id: string) => ReleaseBehaviour) {
  const u = pruneUser(behaviour);
  execFileSync("git", ["init", "-q", u.live]);
  const worktreeId = worktreeIdFor(u.live as AbsolutePath);
  /** The worktree's daemon, in its own process: `heartbeat`, or `claim` (prints the status). */
  const daemon = async (action: "heartbeat" | "claim") =>
    JSON.parse(
      (
        await run(process.execPath, [
          "--import",
          TSX,
          DAEMON,
          action,
          u.live,
          u.env.XDG_STATE_HOME as string,
        ])
      ).stdout || "null",
    ) as string | null;
  return { ...u, worktreeId, daemon };
}

const records = (env: NodeJS.ProcessEnv) => readMachines(env).machines.map((m) => [m.id, m.status]);

/** A gate a release waits on. */
function gate() {
  let open = () => {};
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

const pending = async (released: readonly unknown[], count = 1) => {
  while (released.length < count) await new Promise((resolve) => setTimeout(resolve, 5));
};

describe("a daemon that cannot be read keeps its machine (review 0.1.667 B1)", () => {
  it("keeps a machine whose worktree's live daemon sits in a store it cannot read", async () => {
    const u = repoUser();
    const scope = machineScope();
    u.track({
      id: "cmd:slept",
      worktreeId: u.worktreeId,
      status: "sleeping",
      lastUsedAt: ago(25),
      scope,
    });
    await u.daemon("heartbeat");
    // Control: a readable fresh heartbeat keeps a machine its long-lived daemon let sleep 25 h.
    const control = await pruneRemovedWorktrees({ env: u.env, providerOf: u.providerOf, scope });
    expect(control).toMatchObject({ unused: 0, outcomes: [] });

    const squeal = join(u.live, ".git", "squeal");
    chmodSync(squeal, 0o000);
    onTestFinished(() => chmodSync(squeal, 0o700));
    const result = await pruneRemovedWorktrees({ env: u.env, providerOf: u.providerOf, scope });
    chmodSync(squeal, 0o700);
    expect(result.outcomes).toMatchObject([
      {
        kind: "kept",
        record: { id: "cmd:slept" },
        reason: "its worktree's daemon could not be read",
      },
    ]);
    expect(u.released).toEqual([]);
    expect(records(u.env)).toEqual([["cmd:slept", "sleeping"]]);
  });

  it("releases one whose repository has no daemon recorded", async () => {
    const u = repoUser();
    const scope = machineScope();
    u.track({
      id: "cmd:crashed",
      worktreeId: u.worktreeId,
      status: "awake",
      lastUsedAt: ago(25),
      scope,
    });
    const result = await pruneRemovedWorktrees({ env: u.env, providerOf: u.providerOf, scope });
    expect(result.outcomes).toMatchObject([{ kind: "released", cause: { how: "crashed" } }]);
    expect(u.released).toEqual([["cmd:crashed", "unused"]]);
  });
});

describe("the prune and a daemon's reuse exclude each other (review 0.1.667 B2)", () => {
  it("keeps the machine and its record when a daemon reattaches the same id after the prune chose it", async () => {
    const first = gate();
    const u = repoUser((id) => (id === "cmd:first" ? first.promise : "ok"));
    u.track({ id: "cmd:first", worktreeRoot: u.gone() });
    u.track({
      id: "cmd:old",
      worktreeId: u.worktreeId,
      detachedAt: ago(25),
      scope: machineScope(),
    });
    const pruning = pruneRemovedWorktrees({ env: u.env, providerOf: u.providerOf });
    await pending(u.released);
    // Chosen, not yet claimed: the worktree's new daemon claims the same machine to reuse it.
    expect(await u.daemon("claim")).toBe("awake");
    first.open();
    const result = await pruning;
    expect(result.outcomes.at(-1)).toMatchObject({
      kind: "kept",
      record: { id: "cmd:old" },
      reason: "it was used again",
    });
    expect(u.released).toEqual([["cmd:first", "worktree-removed"]]);
    expect(records(u.env)).toEqual([["cmd:old", "awake"]]);
  });

  it("never lets a daemon reuse a machine the prune claimed; the release goes on", async () => {
    const releasing = gate();
    const u = repoUser((id) => (id === "cmd:old" ? releasing.promise : "ok"));
    u.track({
      id: "cmd:old",
      worktreeId: u.worktreeId,
      detachedAt: ago(25),
      scope: machineScope(),
    });
    const pruning = pruneRemovedWorktrees({ env: u.env, providerOf: u.providerOf });
    await pending(u.released);
    expect(records(u.env)).toEqual([["cmd:old", "deleting"]]);
    // The daemon finds the claim and leaves it: it acquires another machine instead.
    expect(await u.daemon("claim")).toBe("deleting");
    expect(records(u.env)).toEqual([["cmd:old", "deleting"]]);
    releasing.open();
    expect((await pruning).outcomes).toMatchObject([{ kind: "released" }]);
    expect(u.released).toEqual([["cmd:old", "unused"]]);
    expect(records(u.env)).toEqual([]);
  });

  it("releases a record a prune left deleting at its abort, at the next prune", async () => {
    const u = repoUser((id) => (id === "cmd:old" && u.released.length === 1 ? "hang" : "ok"));
    u.track({
      id: "cmd:old",
      worktreeId: u.worktreeId,
      detachedAt: ago(25),
      scope: machineScope(),
    });
    const stop = new AbortController();
    const pruning = pruneRemovedWorktrees({
      env: u.env,
      providerOf: u.providerOf,
      signal: stop.signal,
    });
    await pending(u.released);
    stop.abort();
    expect(await pruning).toMatchObject({ aborted: true, outcomes: [] });
    expect(records(u.env)).toEqual([["cmd:old", "deleting"]]);

    const next = await pruneRemovedWorktrees({ env: u.env, providerOf: u.providerOf });
    expect(next.outcomes).toMatchObject([
      { kind: "released", record: { id: "cmd:old" }, cause: { kind: "unfinished" } },
    ]);
    expect(u.released).toEqual([
      ["cmd:old", "unused"],
      ["cmd:old", "unused"],
    ]);
    expect(records(u.env)).toEqual([]);
  });
});

describe("an old record of no scope (review 0.1.667 N1)", () => {
  it("marked awake, is claimed and judged unused by the same automatic prune", async () => {
    const u = repoUser();
    const scope = machineScope();
    u.track({ id: "cmd:legacy", worktreeId: u.worktreeId, status: "awake", lastUsedAt: ago(25) });
    const result = await pruneRemovedWorktrees({ env: u.env, providerOf: u.providerOf, scope });
    expect(result.outcomes).toMatchObject([
      { kind: "released", record: { id: "cmd:legacy", scope }, cause: { how: "crashed" } },
    ]);
    expect(records(u.env)).toEqual([]);
  });

  it("is kept by the same prune while its worktree's daemon is live", async () => {
    const u = repoUser();
    u.track({ id: "cmd:legacy", worktreeId: u.worktreeId, status: "awake", lastUsedAt: ago(25) });
    await u.daemon("heartbeat");
    const result = await pruneRemovedWorktrees({
      env: u.env,
      providerOf: u.providerOf,
      scope: machineScope(),
    });
    expect(result.outcomes).toEqual([]);
    expect(records(u.env)).toEqual([["cmd:legacy", "awake"]]);
  });
});
