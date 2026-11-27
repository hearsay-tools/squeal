import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { EnsureDaemonOptions } from "../../src/core/daemon/ensure.js";
import { claimHandoff, clearHandoff } from "../../src/core/presence/events.js";
import {
  daemonExitMetaKey,
  HANDOFF_BOUND_MS,
  handoffMetaKey,
  readHandoff,
  SUCCESSOR_LOCK_WAIT_MS,
} from "../../src/core/presence/stored.js";
import { storePaths } from "../../src/core/store/paths.js";
import type { EpochMs } from "../../src/core/types/common.js";
import type { DaemonRequest } from "../../src/core/types/daemon.js";
import { runHook } from "../../src/harness/claude-code/hooks.js";
import { openContext } from "../../src/harness/shared/context.js";
import { ensure } from "../../src/harness/shared/ensure.js";
import type { HookDeps } from "../../src/harness/shared/hook.js";
import { recorded, type SquealRepo, squealRepo } from "./helpers.js";

/*
 * Row 011-32 (011 C9 as amended 2026-10-20, design 011-30 section 2): one
 * successor per handoff. Six hooks over 3.4 s spawned six successors in
 * every cross-version run of the probe; the hook whose step-down was
 * accepted now claims the handoff in `meta`, and only that hook spawns.
 * Against a stand-in socket that accepts every step-down, as a stepping
 * daemon does; `test/daemon/handover` runs real daemons.
 */

const OLD = "0.1.0";
const HOOK = "0.1.31";

let dir: string;
const servers: Server[] = [];
const cleanups: (() => void)[] = [];
beforeEach(() => {
  dir = mkdtempSync("/tmp/sq-");
});
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  for (const server of servers.splice(0)) server.close();
  rmSync(dir, { recursive: true, force: true });
});

/**
 * A daemon at `OLD` with its heartbeat at `clock()` that accepts every
 * step-down; what it was asked. By default the heartbeat stays fresh an
 * hour. With `stops`, it has a 5 s interval and stops as a stepping
 * daemon's does, and an accepted step-down writes the shutdown's mark
 * (`#markExit`), unless `marks` is false (a release before 0.1.121). Its
 * ping answers as the daemon the store records, which a hook checks before
 * it asks (row 011-151); `handoff-endpoint` replaces the daemon at the socket.
 */
async function stepping(
  r: SquealRepo,
  clock: () => number,
  options: { readonly stops?: boolean; readonly marks?: boolean } = {},
): Promise<DaemonRequest[]> {
  const stops = options.stops ?? false;
  const marks = options.marks ?? stops;
  const socketPath = join(dir, "d.sock");
  const asked: DaemonRequest[] = [];
  const server = createServer((socket) => {
    socket.on("error", () => {});
    socket.once("data", (chunk) => {
      const request = JSON.parse(chunk.toString("utf8")) as DaemonRequest;
      asked.push(request);
      if (request.type === "step-down" && marks) {
        r.store.meta.set(daemonExitMetaKey(r.worktreeId), `${OLD}@1#t`);
      }
      const startedAt = r.store.worktrees.get(r.worktreeId)?.daemon?.startedAt;
      const answer =
        request.type === "step-down"
          ? { ok: true, type: "step-down", squealVersion: OLD, steppingDown: true }
          : request.type === "ping"
            ? { ok: true, type: "ping", pid: 1, squealVersion: OLD, phase: "ready", startedAt }
            : { ok: true, type: request.type };
      socket.end(`${JSON.stringify({ schemaVersion: 1, ...answer })}\n`);
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(socketPath, resolve));
  r.store.worktrees.setDaemon(r.worktreeId, {
    socketPath,
    startedAt: 1 as EpochMs,
    heartbeatAt: clock() as EpochMs,
    // Without `stops`, the boundaries all read it alive.
    heartbeatIntervalMs: stops ? 5_000 : 3_600_000,
    squealVersion: OLD,
    token: "t",
  });
  return asked;
}

/** Hook deps at `HOOK` whose `ensureDaemon` records each call; `successors` are the lock waits. */
function recording(clock: () => number) {
  const calls: EnsureDaemonOptions[] = [];
  const deps: HookDeps = {
    env: {},
    cli: "/plugin/dist/cli/squeal.mjs",
    squealVersion: HOOK,
    now: () => clock() as EpochMs,
    harnessProcess: () => null,
    ensureDaemon: async (_root, options) => {
      calls.push(options);
      return options.awaitLockMs === undefined ? "alive" : "spawned";
    },
  };
  const successors = () => calls.filter((call) => call.awaitLockMs !== undefined);
  return { calls, successors, deps };
}

const boundary = (r: SquealRepo, name: string, deps: HookDeps, session: string) =>
  runHook(name as never, recorded(name, r.root, { session_id: session }), deps);

const stepDowns = (asked: DaemonRequest[]) => asked.filter((a) => a.type === "step-down").length;

describe("one successor per handoff (row 011-32)", () => {
  it("six boundaries against a stepping daemon, three concurrent and three sequential, spawn once", async () => {
    const r = squealRepo();
    const clock = () => Date.now();
    const asked = await stepping(r, clock);
    const { successors, deps } = recording(clock);

    await Promise.all(["s1", "s2", "s3"].map((s) => boundary(r, "session-start", deps, s)));
    await boundary(r, "post-tool-batch", deps, "s1");
    await boundary(r, "session-start", deps, "s4");
    await boundary(r, "post-tool-batch", deps, "s2");

    expect(successors()).toEqual([
      expect.objectContaining({ awaitLockMs: SUCCESSOR_LOCK_WAIT_MS }),
    ]);
    // The concurrent three asked before any claim was written; the sequential three asked nothing.
    expect(stepDowns(asked)).toBe(3);
    expect(readHandoff(r.store, r.worktreeId)).toMatchObject({ from: `${OLD}@1#t`, to: HOOK });
  });

  it("claims with the old daemon's incarnation, the hook's version, its time and a 130 s bound", async () => {
    const r = squealRepo();
    const at = 1_800_000_000_000;
    await stepping(r, () => at);
    await boundary(r, "session-start", recording(() => at).deps, "s1");
    expect(HANDOFF_BOUND_MS).toBe(SUCCESSOR_LOCK_WAIT_MS + 10_000);
    expect(readHandoff(r.store, r.worktreeId)).toEqual({
      from: `${OLD}@1#t`,
      to: HOOK,
      at,
      boundAt: at + 130_000,
      attempt: expect.stringMatching(/^[0-9a-f-]{36}$/),
    });
  });

  // Review 0.1.259, B1: a stepping daemon's heartbeat stops long before the claim's bound.
  it.each([
    ["its shutdown's mark", true],
    ["no mark (a release before 0.1.121)", false],
  ])(
    "spawns again at the next boundary past the claim's bound, the heartbeat stopped, with %s",
    async (_, marks) => {
      const r = squealRepo();
      const at = 1_800_000_000_000;
      let now = at;
      const asked = await stepping(r, () => at, { stops: true, marks });
      const { successors, deps } = recording(() => now);
      await boundary(r, "session-start", deps, "s1");
      now += HANDOFF_BOUND_MS - 1;
      await boundary(r, "post-tool-batch", deps, "s1");
      expect(successors()).toHaveLength(1);

      now += 1;
      await boundary(r, "post-tool-batch", deps, "s1");
      expect(successors()).toHaveLength(2);
      // The daemon steps down already: it is asked nothing more.
      expect(stepDowns(asked)).toBe(1);
      expect(readHandoff(r.store, r.worktreeId)).toEqual({
        from: `${OLD}@1#t`,
        to: HOOK,
        at: now,
        boundAt: now + HANDOFF_BOUND_MS,
        attempt: expect.any(String),
      });
    },
  );

  it("spawns again at once after the successor's lock wait ended the claim, the heartbeat stopped", async () => {
    const r = squealRepo();
    const at = 1_800_000_000_000;
    let now = at;
    const asked = await stepping(r, () => at, { stops: true });
    const { successors, deps } = recording(() => now);
    await boundary(r, "session-start", deps, "s1");
    now += SUCCESSOR_LOCK_WAIT_MS + 1;
    // What `lockWaitTimedOut` does in its note's write (`test/daemon/handoff-claim`).
    clearHandoff(r.store, r.worktreeId);
    await boundary(r, "post-tool-batch", deps, "s1");
    expect(successors()).toHaveLength(2);
    expect(stepDowns(asked)).toBe(1);
    expect(readHandoff(r.store, r.worktreeId)).toMatchObject({ at: now });
  });

  it("asks a daemon whose heartbeat stopped with no shutdown and no claim nothing, and spawns no successor", async () => {
    const r = squealRepo();
    const at = 1_800_000_000_000;
    const asked = await stepping(r, () => at, { stops: true });
    const { calls, successors, deps } = recording(() => at + 60_000);
    await boundary(r, "post-tool-batch", deps, "s1");
    // The first step-down needs a live heartbeat; the hook ensures as it always did.
    expect(asked).toEqual([]);
    expect(calls).toHaveLength(1);
    expect(successors()).toEqual([]);
    expect(readHandoff(r.store, r.worktreeId)).toBeNull();
  });

  it("asks again for a daemon of another incarnation, whatever the claim", async () => {
    const r = squealRepo();
    const asked = await stepping(r, () => Date.now());
    const { successors, deps } = recording(() => Date.now());
    await boundary(r, "session-start", deps, "s1");
    const record = r.store.worktrees.get(r.worktreeId)?.daemon;
    if (record === undefined || record === null) throw new Error("no record");
    r.store.worktrees.setDaemon(r.worktreeId, { ...record, startedAt: 2 as EpochMs });
    await boundary(r, "post-tool-batch", deps, "s1");
    expect(successors()).toHaveLength(2);
    expect(stepDowns(asked)).toBe(2);
  });

  /*
   * Row 011-434 (census G6): a hook whose claim write threw said `claimed`
   * and spawned a successor with the lock wait, while no claim was stored,
   * so `squeal start` claimed too and spawned a second one beside it
   * (`handover-tier`, CI 42229025101). Now a hook says `claimed` only once
   * its claim is stored; else it ensures as before, with no lock wait.
   */
  it("spawns no lock wait on a store too busy to take the claim, and leaves the claim to the next", async () => {
    const r = squealRepo();
    const asked = await stepping(r, () => Date.now());
    const { calls, successors, deps } = recording(() => Date.now());
    const location = { root: r.root, commonDir: r.repo.commonDir } as never;
    const holder = new DatabaseSync(storePaths(r.repo.commonDir as never).database);
    cleanups.push(() => holder.close());
    holder.exec("BEGIN IMMEDIATE");
    for (const session of ["s1", "s2"]) {
      const context = openContext({ session_id: session }, location, { busyTimeoutMs: 50 });
      if (context === null) throw new Error("no store");
      try {
        expect(await ensure(location, deps, context)).toBe("alive");
      } finally {
        context.close();
      }
    }
    holder.exec("ROLLBACK");
    expect(successors()).toEqual([]);
    expect(calls).toHaveLength(2);
    expect(stepDowns(asked)).toBe(2);
    expect(r.store.meta.get(handoffMetaKey(r.worktreeId))).toBeNull();
    // `squeal start`'s claim (`claims` in `cli/start.ts`) is then the only one written: one successor.
    const claim = { from: `${OLD}@1#t`, to: "0.1.32", at: Date.now() as EpochMs };
    expect(claimHandoff(r.store, r.worktreeId, claim)).not.toBeNull();
  });

  it("spawns the successor when the claim was stored but its write threw after", async () => {
    const r = squealRepo();
    const asked = await stepping(r, () => Date.now());
    const { successors, deps } = recording(() => Date.now());
    const location = { root: r.root, commonDir: r.repo.commonDir } as never;
    const opened = openContext({ session_id: "s1" }, location);
    if (opened === null) throw new Error("no store");
    // The daemon wrote the claim and its answer was lost.
    const context = {
      ...opened,
      write: async <T>(work: () => T | Promise<T>): Promise<T> => {
        await opened.write(work);
        throw new Error("the connection closed");
      },
    };
    try {
      expect(await ensure(location, deps, context)).toBe("spawned");
    } finally {
      opened.close();
    }
    expect(successors()).toEqual([
      expect.objectContaining({ awaitLockMs: SUCCESSOR_LOCK_WAIT_MS }),
    ]);
    expect(stepDowns(asked)).toBe(1);
    expect(readHandoff(r.store, r.worktreeId)).toMatchObject({ from: `${OLD}@1#t`, to: HOOK });
  });

  it("stays joined when its write threw after another hook's claim of the same millisecond", async () => {
    const r = squealRepo();
    const at = Date.now();
    const asked = await stepping(r, () => at);
    const { successors, deps } = recording(() => at);
    const location = { root: r.root, commonDir: r.repo.commonDir } as never;
    const first = openContext({ session_id: "s1" }, location);
    const second = openContext({ session_id: "s2" }, location);
    if (first === null || second === null) throw new Error("no store");
    // B read no claim; A claims and spawns before B's write, which joins A's, then its answer is lost.
    const context = {
      ...second,
      write: async <T>(work: () => T | Promise<T>): Promise<T> => {
        expect(await ensure(location, deps, first)).toBe("spawned");
        await second.write(work);
        throw new Error("the connection closed");
      },
    };
    try {
      expect(await ensure(location, deps, context)).toBe("alive");
    } finally {
      first.close();
      second.close();
    }
    expect(successors()).toEqual([
      expect.objectContaining({ awaitLockMs: SUCCESSOR_LOCK_WAIT_MS }),
    ]);
    expect(stepDowns(asked)).toBe(2);
  });

  it("reads no other hook's claim of the same millisecond as its own after its own rolled back", async () => {
    const r = squealRepo();
    const at = Date.now();
    const asked = await stepping(r, () => at);
    const { successors, deps } = recording(() => at);
    const location = { root: r.root, commonDir: r.repo.commonDir } as never;
    const first = openContext({ session_id: "s1" }, location);
    const second = openContext({ session_id: "s2" }, location);
    if (first === null || second === null) throw new Error("no store");
    // B claims in a transaction that rolls back; A claims and spawns; B's write is rejected.
    const context = {
      ...second,
      write: async <T>(work: () => T | Promise<T>): Promise<T> => {
        expect(() =>
          second.store.transaction(() => {
            void work();
            throw new Error("rolled back");
          }),
        ).toThrow("rolled back");
        expect(readHandoff(r.store, r.worktreeId)).toBeNull();
        expect(await ensure(location, deps, first)).toBe("spawned");
        throw new Error("the write was rejected");
      },
    };
    try {
      expect(await ensure(location, deps, context)).toBe("alive");
    } finally {
      first.close();
      second.close();
    }
    expect(successors()).toEqual([
      expect.objectContaining({ awaitLockMs: SUCCESSOR_LOCK_WAIT_MS }),
    ]);
    expect(stepDowns(asked)).toBe(2);
  });

  it("asks nothing and reads the daemon alive at a boundary that finds a live claim", async () => {
    const r = squealRepo();
    const asked = await stepping(r, () => Date.now());
    const { calls, deps } = recording(() => Date.now());
    await boundary(r, "session-start", deps, "s1");
    const location = { root: r.root, commonDir: r.repo.commonDir } as never;
    const context = openContext({ session_id: "s2" }, location);
    if (context === null) throw new Error("no store");
    try {
      expect(await ensure(location, deps, context)).toBe("alive");
    } finally {
      context.close();
    }
    expect(calls).toHaveLength(1);
    expect(stepDowns(asked)).toBe(1);
  });
});
