import { spawn, spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type CliIo, main } from "../../src/cli/main.js";
import { lockFreed } from "../../src/cli/stop.js";
import { acquireDaemonLock, socketPathFor } from "../../src/core/daemon/index.js";
import { markSpawn, markStart } from "../../src/core/daemon/start-mark.js";
import { DAEMON_START_GRACE_MS } from "../../src/core/delivery/liveness.js";
import { lockFileFor } from "../../src/core/store/index.js";
import type { AbsolutePath, EpochMs, WorktreeId } from "../../src/core/types/index.js";
import { squealRepo } from "../harness/helpers.js";
import { stoppedLine } from "./stop-lines.js";

/*
 * Task 001-340: the daemon's shutdown closes its socket before it releases
 * its lock (D10), and an I/O stall can hold it between the two for seconds.
 * `squeal stop` says stopped only once the lock is free or the daemon's
 * process is gone.
 */

const saved = { ...process.env };
let runtimeDir: string;
const servers: Server[] = [];

beforeEach(() => {
  runtimeDir = mkdtempSync("/tmp/sq-");
  process.env.XDG_RUNTIME_DIR = runtimeDir;
});

afterEach(() => {
  for (const s of servers.splice(0)) s.close();
  rmSync(runtimeDir, { recursive: true, force: true });
  process.env = { ...saved };
});

/**
 * A stand-in daemon of process `pid`, started at `startedAt`: answers ping
 * and stop, and closes its socket after a stop.
 */
function fakeDaemon(path: string, pid: number, startedAt = Date.now()): Promise<Server> {
  return new Promise((resolve) => {
    const server = createServer((socket) => {
      socket.once("data", (data) => {
        const request = JSON.parse(data.toString()) as { type: string };
        const base = { schemaVersion: 1, ok: true, type: request.type };
        const ping = {
          pid,
          worktreeId: "0123456789abcdef",
          root: "/",
          squealVersion: "0.0.0-test",
          phase: "ready",
          startedAt,
        };
        socket.end(`${JSON.stringify(request.type === "ping" ? { ...base, ...ping } : base)}\n`);
        if (request.type === "stop") server.close();
      });
    });
    servers.push(server);
    server.listen(path, () => resolve(server));
  });
}

async function stop(cwd: string) {
  let stdout = "";
  const io: CliIo = {
    stdout: (text) => {
      stdout += text;
    },
    stderr: () => {},
    cwd,
  };
  const started = performance.now();
  const code = await main(["stop"], io);
  return { code, stdout, ms: performance.now() - started };
}

/** A pid no process has: a child's, after it exited. */
function goneProcess(): number {
  const child = spawnSync(process.execPath, ["-e", "console.log(process.pid)"], {
    encoding: "utf8",
  });
  return Number.parseInt(child.stdout, 10);
}

describe("squeal stop waits for the daemon's lock (task 001-340, D10)", () => {
  it("does not say stopped while the stopping daemon still holds its lock", async () => {
    const r = squealRepo();
    // The stopping daemon cleared its record before its socket went (D10).
    r.daemon("none");
    await fakeDaemon(socketPathFor(r.worktreeId as WorktreeId), process.pid);
    const lock = acquireDaemonLock(
      lockFileFor(r.repo.commonDir as AbsolutePath, r.worktreeId as WorktreeId),
    );
    expect(lock).not.toBeNull();
    const released = new Promise((resolve) => setTimeout(resolve, 600)).then(() => lock?.release());

    const stopped = await stop(r.root);
    await released;
    expect(stopped).toMatchObject({ code: 0, stdout: stoppedLine(r.root) });
    expect(stopped.ms).toBeGreaterThanOrEqual(550);
  });

  it("says stopped once the daemon's process is gone, whoever took the lock since", async () => {
    const r = squealRepo();
    // The stopping daemon cleared its record before its socket went (D10).
    r.daemon("none");
    await fakeDaemon(socketPathFor(r.worktreeId as WorktreeId), goneProcess());
    // A replacement took the lock the moment the stopping daemon let go.
    const replacement = acquireDaemonLock(
      lockFileFor(r.repo.commonDir as AbsolutePath, r.worktreeId as WorktreeId),
    );
    try {
      const stopped = await stop(r.root);
      expect(stopped).toMatchObject({ code: 0, stdout: stoppedLine(r.root) });
      expect(stopped.ms).toBeLessThan(5_000);
    } finally {
      replacement?.release();
    }
  });

  it("says stopped once a daemon of another start time is recorded, though the pid lives on (reused)", async () => {
    const r = squealRepo();
    // The stopping daemon's pid now names another live process: this one.
    await fakeDaemon(socketPathFor(r.worktreeId as WorktreeId), process.pid, 7);
    // Its replacement holds the lock and registered: only after it took the lock.
    const replacement = acquireDaemonLock(lockFile(r));
    r.daemon("alive");
    try {
      const stopped = await stop(r.root);
      expect(stopped).toMatchObject({ code: 0, stdout: stoppedLine(r.root) });
      expect(stopped.ms).toBeLessThan(5_000);
    } finally {
      replacement?.release();
    }
  }, 60_000);
});

describe("squeal stop with a lock it cannot probe (review 001-344, B1)", () => {
  it("falls back to the pid: does not say stopped until the daemon's process is gone", async () => {
    const r = squealRepo();
    r.daemon("none");
    const daemon = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60_000)"]);
    const exited = new Promise((resolve) => daemon.once("exit", resolve));
    try {
      await fakeDaemon(socketPathFor(r.worktreeId as WorktreeId), daemon.pid ?? 0);
      const lock = acquireDaemonLock(lockFile(r));
      expect(lock).not.toBeNull();
      // The probe cannot open the lock database; the holder keeps its lock.
      chmodSync(lockFile(r), 0o000);
      const killed = new Promise((resolve) => setTimeout(resolve, 600)).then(() => daemon.kill());
      try {
        const stopped = await stop(r.root);
        await killed;
        expect(stopped).toMatchObject({ code: 0, stdout: stoppedLine(r.root) });
        expect(stopped.ms).toBeGreaterThanOrEqual(550);
      } finally {
        lock?.release();
      }
    } finally {
      daemon.kill("SIGKILL");
      await exited;
    }
  });

  it("with the holder's process alive, reports the lock unchecked at its bound, never free", async () => {
    const r = squealRepo();
    r.daemon("none");
    const lock = acquireDaemonLock(lockFile(r));
    chmodSync(lockFile(r), 0o000);
    try {
      const check = await lockFreed(r.root, { pid: process.pid, startedAt: 7 }, 300);
      expect(check).toMatchObject({ state: "unchecked", error: expect.any(String) });
      // Without a pid to check, the same.
      expect(await lockFreed(r.root, null, 300)).toMatchObject({ state: "unchecked" });
    } finally {
      lock?.release();
    }
  });
});

describe("squeal stop with a lock directory it cannot search (review 001-347, B1)", () => {
  /*
   * `existsSync` is false for a path under a directory without search
   * permission as well as for a missing one: only a lookup that says the
   * path is missing proves the lock gone.
   */
  it("with the holder's process alive, reports the lock unchecked at its bound, never free", async () => {
    const r = squealRepo();
    r.daemon("none");
    const lock = acquireDaemonLock(lockFile(r));
    expect(lock).not.toBeNull();
    chmodSync(dirname(lockFile(r)), 0o000);
    try {
      const check = await lockFreed(r.root, { pid: process.pid, startedAt: 7 }, 200);
      expect(check).toMatchObject({ state: "unchecked", error: expect.any(String) });
      expect(await lockFreed(r.root, null, 200)).toMatchObject({ state: "unchecked" });
    } finally {
      chmodSync(dirname(lockFile(r)), 0o700);
      lock?.release();
    }
  });

  it("does not say stopped until the daemon's process is gone", async () => {
    const r = squealRepo();
    r.daemon("none");
    const daemon = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60_000)"]);
    const exited = new Promise((resolve) => daemon.once("exit", resolve));
    const lock = acquireDaemonLock(lockFile(r));
    expect(lock).not.toBeNull();
    try {
      await fakeDaemon(socketPathFor(r.worktreeId as WorktreeId), daemon.pid ?? 0);
      chmodSync(dirname(lockFile(r)), 0o000);
      const killed = new Promise((resolve) => setTimeout(resolve, 600)).then(() => daemon.kill());
      const stopped = await stop(r.root);
      await killed;
      expect(stopped).toMatchObject({ code: 0, stdout: stoppedLine(r.root) });
      expect(stopped.ms).toBeGreaterThanOrEqual(550);
    } finally {
      chmodSync(dirname(lockFile(r)), 0o700);
      lock?.release();
      daemon.kill("SIGKILL");
      await exited;
    }
  });
});

function lockFile(r: ReturnType<typeof squealRepo>): AbsolutePath {
  return lockFileFor(r.repo.commonDir as AbsolutePath, r.worktreeId as WorktreeId);
}

describe("squeal stop's lock wait beside the marks (row 011-251, F4)", () => {
  /*
   * A probe takes the lock for a moment, and a hook's older spawn that meets
   * it exits as a loser (C9). The wait reads the marks beside the lock first.
   */
  const exclusive = () => {
    const exec = vi.spyOn(DatabaseSync.prototype, "exec");
    return () => exec.mock.calls.flat().filter((sql) => sql === "BEGIN EXCLUSIVE").length;
  };
  afterEach(() => vi.restoreAllMocks());

  it("reads another process's start mark as the stopping daemon's lock gone, with no probe", async () => {
    const r = squealRepo();
    r.daemon("none");
    const lock = acquireDaemonLock(lockFile(r));
    if (lock === null) throw new Error("the lock is taken");
    // A daemon started since, which holds the lock and marks its start; the stopping one lives on.
    const marked = markStart(lockFile(r), lock);
    const probes = exclusive();
    try {
      expect(await lockFreed(r.root, { pid: process.ppid, startedAt: 7 }, 300)).toEqual({
        state: "free",
      });
      expect(probes()).toBe(0);
      // Its own mark, left behind, is its lock still held.
      expect(await lockFreed(r.root, { pid: process.pid, startedAt: 7 }, 100)).toEqual({
        state: "held",
      });
      expect(probes()).toBe(0);
    } finally {
      marked.release();
    }
  });

  it("probes no lock while a hook's spawn is marked, and probes once the mark lapses", async () => {
    const r = squealRepo();
    r.daemon("none");
    // The lock file a daemon that ran leaves, its lock free.
    acquireDaemonLock(lockFile(r))?.release();
    markSpawn(lockFile(r), (Date.now() - DAEMON_START_GRACE_MS + 300) as EpochMs, null);
    const probes = exclusive();
    const started = Date.now();

    const check = await lockFreed(r.root, { pid: process.ppid, startedAt: 7 }, 5_000);

    expect(check).toEqual({ state: "free" });
    expect(Date.now() - started).toBeGreaterThanOrEqual(250);
    expect(probes()).toBe(1);
  });
});
