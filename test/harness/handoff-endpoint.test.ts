import { mkdtempSync, renameSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EnsureDaemonOptions } from "../../src/core/daemon/ensure.js";
import { claimHandoff, endHandoff, readShortHandoff } from "../../src/core/delivery/handoff.js";
import type { DaemonRequest, EpochMs } from "../../src/core/types/index.js";
import type { HookDeps } from "../../src/harness/claude-code/index.js";
import { openContext } from "../../src/harness/shared/context.js";
import { ensureIfStale } from "../../src/harness/shared/ensure.js";
import { type SquealRepo, squealRepo } from "./helpers.js";

/*
 * Row 011-151 (review 0.1.277-r2, B1): a hook's handoff decision reads the
 * daemon's record in one snapshot, then connects to the socket path, which
 * every incarnation of the worktree reuses. A short successor that binds
 * the path and registers in between, or between an accepted step-down and
 * the `stop` after it, is asked nothing and stopped by nothing. The
 * connects are stood in for, so the replacement lands at the named connect.
 */

/** Runs before each connect until it returns true. */
const net = vi.hoisted(() => ({ beforeConnect: null as null | (() => boolean) }));

vi.mock("node:net", async (actual) => {
  const original = await actual<typeof import("node:net")>();
  return {
    ...original,
    createConnection: (...args: Parameters<typeof original.createConnection>) => {
      if (net.beforeConnect?.() === true) net.beforeConnect = null;
      return original.createConnection(...args);
    },
  };
});

const OLD = "0.1.272";
const HOOK = "0.1.273";
const PREDECESSOR = `${OLD}@1#t`;
const SUCCESSOR = `${OLD}@2#u`;
const EXECUTABLE = "/data/versions/0.1.273/dist/cli/squeal.mjs";

let dir: string;
const servers: Server[] = [];
beforeEach(() => {
  dir = mkdtempSync("/tmp/sq-");
});
afterEach(() => {
  net.beforeConnect = null;
  for (const server of servers.splice(0)) server.close();
  rmSync(dir, { recursive: true, force: true });
});

const socketPath = () => join(dir, "d.sock");

/**
 * A stand-in daemon of `OLD` started at `startedAt`, answering as a real
 * one and accepting every step-down; what it was asked. It listens at a
 * staging name, and `bind` renames that over the socket path, as `bindAt`
 * does, so a predecessor's listener keeps its connections.
 */
async function standIn(
  r: SquealRepo,
  startedAt: number,
): Promise<{ asked: DaemonRequest[]; bind: () => void }> {
  const staging = join(dir, `.${startedAt}`);
  const asked: DaemonRequest[] = [];
  const answer = (request: DaemonRequest) => {
    if (request.type === "ping") {
      const at = { pid: process.pid, worktreeId: r.worktreeId, root: r.root };
      return { ok: true, type: "ping", ...at, squealVersion: OLD, phase: "running", startedAt };
    }
    if (request.type === "step-down") {
      return { ok: true, type: "step-down", squealVersion: OLD, steppingDown: true };
    }
    return { ok: true, type: request.type };
  };
  const server = createServer((socket) => {
    socket.on("error", () => {});
    socket.once("data", (chunk) => {
      const request = JSON.parse(chunk.toString("utf8")) as DaemonRequest;
      asked.push(request);
      socket.end(`${JSON.stringify({ schemaVersion: 1, ...answer(request) })}\n`);
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(staging, resolve));
  return { asked, bind: () => renameSync(staging, socketPath()) };
}

/** Records the daemon of `OLD` started at `startedAt` with `token`, alive an hour. */
function recordAt(r: SquealRepo, startedAt: number, token: string): void {
  r.store.worktrees.setDaemon(r.worktreeId, {
    socketPath: socketPath() as never,
    startedAt: startedAt as EpochMs,
    heartbeatAt: Date.now() as EpochMs,
    heartbeatIntervalMs: 3_600_000,
    squealVersion: OLD,
    token,
  });
}

/**
 * Another hook's whole handoff, as the review's probe writes it: its claim
 * from the predecessor, then the short successor's registration, which ends
 * the claim with the mark in its transaction.
 */
function successorRegisters(r: SquealRepo): void {
  r.store.transaction(() => {
    const at = Date.now() as EpochMs;
    claimHandoff(r.store, r.worktreeId, { from: PREDECESSOR, to: HOOK, at });
    recordAt(r, 2, "u");
    endHandoff(r.store, r.worktreeId, { of: SUCCESSOR, version: OLD, executable: EXECUTABLE, at });
  });
}

/** Hook deps at `HOOK`; `calls` are its spawns and lock waits. */
function hookAt(): { calls: EnsureDaemonOptions[]; deps: HookDeps } {
  const calls: EnsureDaemonOptions[] = [];
  const deps: HookDeps = {
    env: {},
    cli: "/plugin/dist/cli/squeal.mjs",
    squealVersion: HOOK,
    harnessProcess: () => null,
    ensureDaemon: async (_root, options) => {
      calls.push(options);
      return options.awaitLockMs === undefined ? "alive" : "spawned";
    },
  };
  return { calls, deps };
}

/** The predecessor bound and recorded, its successor listening unbound, and a hook at `HOOK`. */
async function handoff() {
  const r = squealRepo();
  const predecessor = await standIn(r, 1);
  predecessor.bind();
  recordAt(r, 1, "t");
  const successor = await standIn(r, 2);
  const { calls, deps } = hookAt();
  const run = async () => {
    const location = { root: r.root, commonDir: r.repo.commonDir } as never;
    const context = openContext({ session_id: "s1" }, location);
    if (context === null) throw new Error("no store");
    try {
      return await ensureIfStale(context, deps);
    } finally {
      context.close();
    }
  };
  const spawns = () => calls.filter((call) => call.awaitLockMs !== undefined);
  return { r, predecessor, successor, run, spawns };
}

describe("a hook's step-down reaches only the incarnation its decision read (row 011-151)", () => {
  it("asks nothing, stops nothing and spawns nothing when a short successor binds and registers before the connect", async () => {
    const { r, predecessor, successor, run, spawns } = await handoff();
    net.beforeConnect = () => {
      successor.bind();
      successorRegisters(r);
      return true;
    };
    expect(await run()).toBe("fresh");
    expect(net.beforeConnect).toBeNull();
    expect(readShortHandoff(r.store, r.worktreeId)?.of).toBe(SUCCESSOR);
    expect(successor.asked.filter((a) => a.type !== "ping")).toEqual([]);
    expect(predecessor.asked.filter((a) => a.type !== "ping")).toEqual([]);
    expect(spawns()).toEqual([]);
  });

  it("does not stop a short successor that binds and registers between the accepted step-down and the stop", async () => {
    const { r, predecessor, successor, run, spawns } = await handoff();
    net.beforeConnect = () => {
      if (!predecessor.asked.some((a) => a.type === "step-down")) return false;
      successor.bind();
      successorRegisters(r);
      return true;
    };
    expect(await run()).toBe("fresh");
    expect(net.beforeConnect).toBeNull();
    expect(predecessor.asked.filter((a) => a.type !== "ping")).toEqual([
      { type: "step-down", version: HOOK },
    ]);
    expect(successor.asked.filter((a) => a.type !== "ping")).toEqual([]);
    expect(spawns()).toEqual([]);
  });

  it("asks the predecessor at an unchanged endpoint, stops it and spawns one successor", async () => {
    const { predecessor, successor, run, spawns } = await handoff();
    expect(await run()).toBe("fresh");
    expect(predecessor.asked.filter((a) => a.type !== "ping")).toEqual([
      { type: "step-down", version: HOOK },
      { type: "stop" },
    ]);
    expect(successor.asked).toEqual([]);
    expect(spawns()).toHaveLength(1);
  });
});
