import { describe, expect, it } from "vitest";
import {
  readMachines,
  recordMachine,
  updateMachine,
} from "../../../src/core/runner-host/remote/machines-store.js";
import { machineScope } from "../../../src/core/runner-host/remote/presence.js";
import type { MachineRecord } from "../../../src/core/runner-host/remote/provider.js";
import { pruneRemovedWorktrees } from "../../../src/core/runner-host/remote/prune.js";
import { durationText, type Liveness } from "../../../src/core/runner-host/remote/prune-unused.js";
import type { AbsolutePath } from "../../../src/core/types/common.js";
import { pruneUser } from "./prune-fakes.js";

/*
 * Row 026-43 (spec 026 D7.3 item 4, D12.5): the prune releases `unused`
 * and forgets a machine whose worktree is there but which no daemon has
 * used for its lane's `deleteUnusedHours` (default 24). Every worktree
 * here is a live directory; `daemonLive` stands for the store's daemon
 * record of each worktree.
 */

const HOUR = 3_600_000;
const ago = (hours: number) => Date.now() - hours * HOUR;
const ids = (env: NodeJS.ProcessEnv) => readMachines(env).machines.map((m) => m.id);
const kinds = (result: Awaited<ReturnType<typeof pruneRemovedWorktrees>>) =>
  result.outcomes.map((o) => [o.kind, o.record.id]);

/** `daemonLive` that answers `live` and records each worktree it was asked about. */
function liveness(live: (root: AbsolutePath) => Liveness = () => "absent") {
  const asked: string[] = [];
  return {
    asked,
    daemonLive: (root: AbsolutePath) => {
      asked.push(root);
      return live(root);
    },
  };
}

describe("a detached machine no daemon used for deleteUnusedHours (row 026-43)", () => {
  it("is released unused and forgotten past the limit; one under it stays", async () => {
    const u = pruneUser();
    u.track({ id: "cmd:old", detachedAt: ago(25) });
    u.track({ id: "cmd:recent", detachedAt: ago(23) });
    const result = await pruneRemovedWorktrees({ env: u.env, providerOf: u.providerOf });
    expect(result).toMatchObject({ gone: 0, unused: 1, aborted: false });
    expect(result.outcomes).toMatchObject([
      { kind: "released", record: { id: "cmd:old" }, cause: { kind: "unused", how: "detached" } },
    ]);
    expect(u.released).toEqual([["cmd:old", "unused"]]);
    expect(ids(u.env)).toEqual(["cmd:recent"]);
  });

  it("follows the lane's deleteUnusedHours; 0 never deletes", async () => {
    const short = pruneUser(() => "ok", { deleteUnusedHours: 2 });
    short.track({ id: "cmd:3h", detachedAt: ago(3) });
    short.track({ id: "cmd:1h", detachedAt: ago(1) });
    await pruneRemovedWorktrees({ env: short.env, providerOf: short.providerOf });
    expect(short.released).toEqual([["cmd:3h", "unused"]]);

    const never = pruneUser(() => "ok", { deleteUnusedHours: 0 });
    never.track({ id: "cmd:year", detachedAt: ago(24 * 365) });
    const result = await pruneRemovedWorktrees({ env: never.env, providerOf: never.providerOf });
    expect(result).toMatchObject({ unused: 0, outcomes: [] });
    expect(ids(never.env)).toEqual(["cmd:year"]);
  });

  it("times an older record without detachedAt by lastUsedAt; detachedAt wins when there", async () => {
    const u = pruneUser();
    u.track({ id: "cmd:no-field", lastUsedAt: ago(30) });
    u.track({ id: "cmd:fresh-exit", lastUsedAt: ago(30), detachedAt: ago(1) });
    const result = await pruneRemovedWorktrees({ env: u.env, providerOf: u.providerOf });
    expect(kinds(result)).toEqual([["released", "cmd:no-field"]]);
    expect(ids(u.env)).toEqual(["cmd:fresh-exit"]);
  });

  it("releases nothing in a dry run, and names why", async () => {
    const u = pruneUser();
    u.track({ id: "cmd:old", detachedAt: ago(25) - 10 * 60_000 });
    const result = await pruneRemovedWorktrees({
      env: u.env,
      dryRun: true,
      providerOf: u.providerOf,
    });
    expect(result.outcomes).toMatchObject([{ kind: "would-release", cause: { kind: "unused" } }]);
    const [outcome] = result.outcomes;
    const idle = outcome?.kind === "would-release" && outcome.cause.kind === "unused";
    expect(idle && durationText(outcome.cause.idleMs)).toBe("25 h 10 min");
    expect(u.released).toEqual([]);
  });

  it("keeps a machine whose worktree has a live daemon", async () => {
    const u = pruneUser();
    u.track({ id: "cmd:old", detachedAt: ago(25), scope: machineScope() });
    const live = liveness(() => "alive");
    const result = await pruneRemovedWorktrees({
      env: u.env,
      providerOf: u.providerOf,
      daemonLive: live.daemonLive,
    });
    expect(result).toMatchObject({ unused: 0, outcomes: [] });
    expect(live.asked).toEqual([u.live]);
    expect(ids(u.env)).toEqual(["cmd:old"]);
  });
});

describe("a machine marked in use whose daemon crashed (row 026-43)", () => {
  it("is released unused once lastUsedAt is past the limit and no daemon is live", async () => {
    const u = pruneUser();
    const scope = machineScope();
    u.track({ id: "cmd:crashed", status: "awake", lastUsedAt: ago(25), scope });
    u.track({ id: "cmd:asleep", status: "sleeping", lastUsedAt: ago(26), scope });
    const result = await pruneRemovedWorktrees({
      env: u.env,
      providerOf: u.providerOf,
      daemonLive: () => "absent",
    });
    expect(result.outcomes).toMatchObject([
      { kind: "released", record: { id: "cmd:crashed" }, cause: { how: "crashed" } },
      { kind: "released", record: { id: "cmd:asleep" }, cause: { how: "crashed" } },
    ]);
    expect(ids(u.env)).toEqual([]);
  });

  it("is kept while its worktree's daemon is live", async () => {
    const u = pruneUser();
    u.track({ id: "cmd:busy", status: "awake", lastUsedAt: ago(25), scope: machineScope() });
    const result = await pruneRemovedWorktrees({
      env: u.env,
      providerOf: u.providerOf,
      daemonLive: () => "alive",
    });
    expect(result.outcomes).toEqual([]);
    expect(ids(u.env)).toEqual(["cmd:busy"]);
  });

  it("is judged by its detached status alone when the record is another scope's or of none (manual prune)", async () => {
    const u = pruneUser();
    u.track({
      id: "cmd:foreign-awake",
      status: "awake",
      lastUsedAt: ago(25),
      scope: "box mnt:[7]",
    });
    u.track({ id: "cmd:old-style-awake", status: "awake", lastUsedAt: ago(25) });
    u.track({ id: "cmd:foreign-detached", detachedAt: ago(25), scope: "box mnt:[7]" });
    const live = liveness();
    const result = await pruneRemovedWorktrees({
      env: u.env,
      providerOf: u.providerOf,
      daemonLive: live.daemonLive,
    });
    expect(kinds(result)).toEqual([["released", "cmd:foreign-detached"]]);
    // A foreign path names no file of this host: its daemon is never read.
    expect(live.asked).toEqual([]);
  });

  it("is released by the automatic prune in its own scope, after claiming a record of none", async () => {
    const u = pruneUser();
    const scope = "host-a mnt:[1]";
    u.track({ id: "cmd:mine", status: "awake", lastUsedAt: ago(25), scope });
    u.track({ id: "cmd:theirs", status: "awake", lastUsedAt: ago(25), scope: "host-b mnt:[2]" });
    u.track({ id: "cmd:none", detachedAt: ago(25) });
    const live = liveness();
    const result = await pruneRemovedWorktrees({
      env: u.env,
      providerOf: u.providerOf,
      scope,
      daemonLive: live.daemonLive,
    });
    expect(kinds(result)).toEqual([
      ["released", "cmd:mine"],
      ["released", "cmd:none"],
    ]);
    expect(ids(u.env)).toEqual(["cmd:theirs"]);
  });
});

describe("the unused check reads a daemon only when it must (row 026-43)", () => {
  it("reads no daemon for records under the limit", async () => {
    const u = pruneUser();
    const scope = machineScope();
    u.track({ id: "cmd:awake", status: "awake", lastUsedAt: ago(1), scope });
    u.track({ id: "cmd:detached", detachedAt: ago(23), scope });
    const live = liveness();
    const result = await pruneRemovedWorktrees({
      env: u.env,
      providerOf: u.providerOf,
      daemonLive: live.daemonLive,
    });
    expect(result.outcomes).toEqual([]);
    expect(live.asked).toEqual([]);
  });
});

describe("a machine used again between the prune's read and its release (row 026-43)", () => {
  /** A gate the release of `cmd:first`, of a removed worktree, waits on, so `cmd:old` waits its turn. */
  function queued() {
    let open = () => {};
    const first = new Promise<void>((resolve) => {
      open = resolve;
    });
    const u = pruneUser((id) => (id === "cmd:first" ? first : "ok"));
    u.track({ id: "cmd:first", worktreeRoot: u.gone() });
    u.track({ id: "cmd:old", detachedAt: ago(25), scope: machineScope() });
    return { u, open };
  }

  const pending = async (u: ReturnType<typeof pruneUser>) => {
    while (u.released.length === 0) await new Promise((resolve) => setTimeout(resolve, 5));
  };

  it("keeps it when a daemon reattached it (status and lastUsedAt moved)", async () => {
    const { u, open } = queued();
    const pruning = pruneRemovedWorktrees({
      env: u.env,
      providerOf: u.providerOf,
      daemonLive: () => "absent",
    });
    await pending(u);
    const old = readMachines(u.env).machines.find((m) => m.id === "cmd:old") as MachineRecord;
    updateMachine(old, { status: "awake", lastUsedAt: Date.now() }, u.env);
    open();
    const result = await pruning;
    expect(result.outcomes).toMatchObject([
      { kind: "released", record: { id: "cmd:first" } },
      { kind: "kept", record: { id: "cmd:old" }, reason: "it was used again" },
    ]);
    expect(u.released).toEqual([["cmd:first", "worktree-removed"]]);
    expect(ids(u.env)).toEqual(["cmd:old"]);
  });

  it("keeps it when another machine replaced it", async () => {
    const { u, open } = queued();
    const pruning = pruneRemovedWorktrees({
      env: u.env,
      providerOf: u.providerOf,
      daemonLive: () => "absent",
    });
    await pending(u);
    const old = readMachines(u.env).machines.find((m) => m.id === "cmd:old") as MachineRecord;
    recordMachine({ ...old, id: "cmd:new", status: "awake", lastUsedAt: Date.now() }, u.env);
    open();
    const result = await pruning;
    expect(result.outcomes.at(-1)).toMatchObject({
      kind: "kept",
      reason: "replaced by machine cmd:new",
    });
    expect(u.released).toEqual([["cmd:first", "worktree-removed"]]);
    expect(ids(u.env)).toEqual(["cmd:new"]);
  });

  it("keeps it when its worktree's daemon started meanwhile", async () => {
    const { u, open } = queued();
    let started = false;
    const pruning = pruneRemovedWorktrees({
      env: u.env,
      providerOf: u.providerOf,
      daemonLive: () => (started ? "alive" : "absent"),
    });
    await pending(u);
    started = true;
    open();
    const result = await pruning;
    expect(result.outcomes.at(-1)).toMatchObject({
      kind: "kept",
      reason: "a daemon of its worktree is live",
    });
    expect(ids(u.env)).toEqual(["cmd:old"]);
  });
});
