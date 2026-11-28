import { type ChildProcess, spawn } from "node:child_process";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { machinesPath, readMachines } from "../../../src/core/runner-host/remote/machines-store.js";
import { machineScope } from "../../../src/core/runner-host/remote/presence.js";
import { pruneRemovedWorktrees } from "../../../src/core/runner-host/remote/prune.js";
import type { WorktreeId } from "../../../src/core/types/common.js";
import { pruneUser } from "./prune-fakes.js";

/*
 * Review 0.1.658 B2, B3, B4 and N1: what a prune may take as evidence
 * that a worktree is gone, and what it may forget after a release. A
 * fake provider records each release; `gate` holds one open until the
 * test lets it settle.
 */

const ids = (env: NodeJS.ProcessEnv) => readMachines(env).machines.map((m) => m.id);

function gate() {
  let open = () => {};
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

/** Another live process that holds the registry's write lock until it exits after `ms`. */
function lockHolder(env: NodeJS.ProcessEnv, ms: number): ChildProcess {
  const lock = `${machinesPath(env)}.lock`;
  mkdirSync(join(lock, ".."), { recursive: true });
  const child = spawn(
    process.execPath,
    ["-e", `setTimeout(() => require("node:fs").unlinkSync(${JSON.stringify(lock)}), ${ms})`],
    { stdio: "ignore" },
  );
  onTestFinished(() => {
    child.kill("SIGKILL");
  });
  writeFileSync(lock, `${child.pid} holder\n`, { mode: 0o600 });
  return child;
}

describe("a worktree that cannot be checked is kept (review 0.1.658 B2)", () => {
  it("releases nothing when the worktree's parent cannot be searched", async () => {
    const u = pruneUser();
    const restricted = u.gone("restricted");
    const live = join(restricted, "live");
    mkdirSync(live, { recursive: true });
    u.track({ id: "cmd:restricted", worktreeRoot: live as never });
    chmodSync(restricted, 0o000);
    onTestFinished(() => chmodSync(restricted, 0o700));
    const result = await pruneRemovedWorktrees({ env: u.env, providerOf: u.providerOf });
    chmodSync(restricted, 0o700);
    expect(result.gone).toBe(0);
    expect(result.outcomes).toMatchObject([
      { kind: "kept", reason: "its worktree could not be checked" },
    ]);
    expect(u.released).toEqual([]);
    expect(ids(u.env)).toEqual(["cmd:restricted"]);
  });
});

describe("each release checks the record as it is now (review 0.1.658 B3)", () => {
  it("skips a machine whose worktree is there again by its turn, and keeps its replacement", async () => {
    const a = gate();
    const u = pruneUser((id) => (id === "cmd:a" ? a.promise : "ok"));
    const b = u.gone("b");
    u.track({ id: "cmd:a", worktreeRoot: u.gone("a") });
    u.track({ id: "cmd:b", worktreeRoot: b as never, worktreeId: "wb" as WorktreeId });
    const pruning = pruneRemovedWorktrees({ env: u.env, providerOf: u.providerOf });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(u.released).toEqual([["cmd:a", "worktree-removed"]]);
    // B's worktree is made again, and its daemon tracks a new machine there.
    mkdirSync(b);
    u.track({ id: "cmd:b-new", worktreeRoot: b as never, worktreeId: "wb" as WorktreeId });
    a.open();
    const result = await pruning;
    expect(result.outcomes.map((o) => [o.kind, o.record.id])).toEqual([
      ["released", "cmd:a"],
      ["kept", "cmd:b"],
    ]);
    expect(u.released).toEqual([["cmd:a", "worktree-removed"]]);
    expect(ids(u.env)).toEqual(["cmd:b-new"]);
  });

  it("skips a machine whose path came back though its record is unchanged", async () => {
    const a = gate();
    const u = pruneUser((id) => (id === "cmd:a" ? a.promise : "ok"));
    const b = u.gone("b");
    u.track({ id: "cmd:a", worktreeRoot: u.gone("a") });
    u.track({ id: "cmd:b", worktreeRoot: b as never });
    const pruning = pruneRemovedWorktrees({ env: u.env, providerOf: u.providerOf });
    await new Promise((resolve) => setTimeout(resolve, 20));
    mkdirSync(b);
    a.open();
    const result = await pruning;
    expect(result.outcomes).toMatchObject([
      { kind: "released" },
      { kind: "kept", reason: "its worktree is there again" },
    ]);
    expect(ids(u.env)).toEqual(["cmd:b"]);
  });

  it("keeps a replacement record written while the old machine's release is in flight", async () => {
    const a = gate();
    const u = pruneUser((id) => (id === "cmd:a" ? a.promise : "ok"));
    const root = u.gone("a");
    u.track({ id: "cmd:a", worktreeRoot: root as never, worktreeId: "wa" as WorktreeId });
    const pruning = pruneRemovedWorktrees({ env: u.env, providerOf: u.providerOf });
    await new Promise((resolve) => setTimeout(resolve, 20));
    u.track({ id: "cmd:a-new", worktreeRoot: root as never, worktreeId: "wa" as WorktreeId });
    a.open();
    expect((await pruning).outcomes.map((o) => o.kind)).toEqual(["released"]);
    expect(ids(u.env)).toEqual(["cmd:a-new"]);
  });
});

describe("the prune never blocks the thread on the registry lock (review 0.1.658 B4)", () => {
  it("keeps a 10 ms timer on time while another process holds the lock", async () => {
    const u = pruneUser();
    u.track({ id: "cmd:old", worktreeRoot: u.gone() });
    lockHolder(u.env, 400);
    const pruning = pruneRemovedWorktrees({ env: u.env, providerOf: u.providerOf });
    const set = performance.now();
    const late = await new Promise<number>((resolve) =>
      setTimeout(() => resolve(performance.now() - set - 10), 10),
    );
    expect(late).toBeLessThan(150);
    const result = await pruning;
    expect(result.outcomes.map((o) => o.kind)).toEqual(["released"]);
    expect(ids(u.env)).toEqual([]);
  });

  it("ends at an abort while it waits for the lock, releases nothing and keeps the record", async () => {
    const u = pruneUser();
    u.track({ id: "cmd:old", worktreeRoot: u.gone() });
    lockHolder(u.env, 60_000);
    const stop = new AbortController();
    const pruning = pruneRemovedWorktrees({
      env: u.env,
      providerOf: u.providerOf,
      signal: stop.signal,
    });
    // Review 0.1.667 B2: the claim under the lock comes before the release.
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(u.released).toEqual([]);
    const began = performance.now();
    stop.abort();
    expect(await pruning).toMatchObject({ outcomes: [], aborted: true });
    expect(performance.now() - began).toBeLessThan(500);
    expect(u.released).toEqual([]);
    expect(ids(u.env)).toEqual(["cmd:old"]);
  });
});

describe("the automatic prune trusts paths of its own scope (review 0.1.658 N1)", () => {
  it("acts on records of its scope or of none, never on another's; claims a live scopeless record", async () => {
    const u = pruneUser();
    const scope = machineScope();
    u.track({ id: "cmd:mine", worktreeRoot: u.gone(), scope });
    u.track({ id: "cmd:old-style", worktreeRoot: u.gone() });
    u.track({ id: "cmd:foreign", worktreeRoot: u.gone(), scope: "container mnt:[1]" });
    u.track({ id: "cmd:live" });
    const result = await pruneRemovedWorktrees({ env: u.env, providerOf: u.providerOf, scope });
    expect(result.outcomes.map((o) => [o.kind, o.record.id])).toEqual([
      ["released", "cmd:mine"],
      ["released", "cmd:old-style"],
    ]);
    const left = readMachines(u.env).machines.map((m) => [m.id, m.scope]);
    expect(left).toEqual([
      ["cmd:foreign", "container mnt:[1]"],
      ["cmd:live", scope],
    ]);
  });

  it("keeps a queued record that moved to another scope before its turn (review 0.1.659-r2 N1)", async () => {
    const a = gate();
    const u = pruneUser((id) => (id === "cmd:a" ? a.promise : "ok"));
    const scope = "host-a mnt:[1]";
    const b = u.gone("b");
    u.track({ id: "cmd:a", worktreeRoot: u.gone("a"), scope });
    u.track({ id: "cmd:b", worktreeRoot: b as never, worktreeId: "wb" as WorktreeId, scope });
    const pruning = pruneRemovedWorktrees({ env: u.env, providerOf: u.providerOf, scope });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(u.released).toEqual([["cmd:a", "worktree-removed"]]);
    // Another namespace records the same machine B, with its own scope.
    const foreign = "host-b mnt:[2]";
    u.track({
      id: "cmd:b",
      worktreeRoot: b as never,
      worktreeId: "wb" as WorktreeId,
      scope: foreign,
    });
    a.open();
    const result = await pruning;
    expect(result.outcomes.map((o) => [o.kind, o.record.id])).toEqual([["released", "cmd:a"]]);
    expect(u.released).toEqual([["cmd:a", "worktree-removed"]]);
    expect(readMachines(u.env).machines.map((m) => [m.id, m.scope])).toEqual([["cmd:b", foreign]]);
  });

  it("keeps the record whose scope changed while its release was in flight (review 0.1.659-r2 N1)", async () => {
    const a = gate();
    const u = pruneUser((id) => (id === "cmd:a" ? a.promise : "ok"));
    const root = u.gone("a");
    const scope = "host-a mnt:[1]";
    u.track({ id: "cmd:a", worktreeRoot: root as never, worktreeId: "wa" as WorktreeId, scope });
    const pruning = pruneRemovedWorktrees({ env: u.env, providerOf: u.providerOf, scope });
    await new Promise((resolve) => setTimeout(resolve, 20));
    const foreign = "host-b mnt:[2]";
    u.track({
      id: "cmd:a",
      worktreeRoot: root as never,
      worktreeId: "wa" as WorktreeId,
      scope: foreign,
    });
    a.open();
    expect((await pruning).outcomes.map((o) => o.kind)).toEqual(["released"]);
    expect(readMachines(u.env).machines.map((m) => [m.id, m.scope])).toEqual([["cmd:a", foreign]]);
  });

  it("the manual prune acts on every record", async () => {
    const u = pruneUser();
    u.track({ id: "cmd:foreign", worktreeRoot: u.gone(), scope: "container mnt:[1]" });
    const result = await pruneRemovedWorktrees({ env: u.env, providerOf: u.providerOf });
    expect(result.outcomes.map((o) => o.kind)).toEqual(["released"]);
    expect(ids(u.env)).toEqual([]);
  });

  it("names this host and, where readable, its mount namespace", () => {
    expect(machineScope()).toMatch(/^\S+( mnt:\[\d+\])?$/);
  });
});
