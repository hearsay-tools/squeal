import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type CliIo, main } from "../../src/cli/main.js";
import { acquireDaemonLock, socketPathFor } from "../../src/core/daemon/index.js";
import { lockFileFor } from "../../src/core/store/index.js";
import type { AbsolutePath, WorktreeId } from "../../src/core/types/index.js";
import { squealRepo } from "../harness/helpers.js";

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

/** A stand-in daemon of process `pid`: answers ping and stop, and closes its socket after a stop. */
function fakeDaemon(path: string, pid: number): Promise<Server> {
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
          startedAt: Date.now(),
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
    await fakeDaemon(socketPathFor(r.worktreeId as WorktreeId), process.pid);
    const lock = acquireDaemonLock(
      lockFileFor(r.repo.commonDir as AbsolutePath, r.worktreeId as WorktreeId),
    );
    expect(lock).not.toBeNull();
    const released = new Promise((resolve) => setTimeout(resolve, 600)).then(() => lock?.release());

    const stopped = await stop(r.root);
    await released;
    expect(stopped).toMatchObject({ code: 0, stdout: `Squeal daemon stopped for ${r.root}\n` });
    expect(stopped.ms).toBeGreaterThanOrEqual(550);
  });

  it("says stopped once the daemon's process is gone, whoever took the lock since", async () => {
    const r = squealRepo();
    await fakeDaemon(socketPathFor(r.worktreeId as WorktreeId), goneProcess());
    // A replacement took the lock the moment the stopping daemon let go.
    const replacement = acquireDaemonLock(
      lockFileFor(r.repo.commonDir as AbsolutePath, r.worktreeId as WorktreeId),
    );
    try {
      const stopped = await stop(r.root);
      expect(stopped).toMatchObject({ code: 0, stdout: `Squeal daemon stopped for ${r.root}\n` });
      expect(stopped.ms).toBeLessThan(5_000);
    } finally {
      replacement?.release();
    }
  });
});
