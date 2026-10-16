import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CliIo } from "../../src/cli/main.js";
import { type StopBounds, stopCommand } from "../../src/cli/stop.js";
import { socketPathFor } from "../../src/core/daemon/index.js";
import type { WorktreeId } from "../../src/core/types/index.js";
import { squealRepo } from "../harness/helpers.js";

/*
 * Task 001-367 (hearsay-tools/squeal#2, D10): `squeal stop` exits 0 only once
 * the daemon and every process it started are gone, and 1 past its bound,
 * naming what is left.
 */

const saved = { ...process.env };
let runtimeDir: string;
const servers: Server[] = [];
const children: ChildProcess[] = [];

beforeEach(() => {
  runtimeDir = mkdtempSync("/tmp/sq-");
  process.env.XDG_RUNTIME_DIR = runtimeDir;
});

afterEach(() => {
  for (const s of servers.splice(0)) s.close();
  for (const c of children.splice(0)) c.kill("SIGKILL");
  rmSync(runtimeDir, { recursive: true, force: true });
  process.env = { ...saved };
});

const BOUNDS: StopBounds = { socketMs: 400, lockMs: 400, leftoversMs: 400 };

/**
 * A stand-in daemon of process `pid`, started at `startedAt`, answering ping
 * and stop; `closes`, it closes its socket after a stop, as a daemon that
 * stopped does.
 */
function fakeDaemon(pid: number, startedAt: number, closes: boolean, worktreeId: string) {
  return new Promise<Server>((resolve) => {
    const server = createServer((socket) => {
      socket.once("data", (data) => {
        const request = JSON.parse(data.toString()) as { type: string };
        const base = { schemaVersion: 1, ok: true, type: request.type };
        const ping = { pid, worktreeId, root: "/", squealVersion: "0.0.0-test", phase: "ready" };
        const answer = request.type === "ping" ? { ...base, ...ping, startedAt } : base;
        socket.end(`${JSON.stringify(answer)}\n`);
        if (request.type === "stop" && closes) server.close();
      });
    });
    servers.push(server);
    server.listen(socketPathFor(worktreeId as WorktreeId), () => resolve(server));
  });
}

async function stop(root: string) {
  let stdout = "";
  const io: CliIo = {
    stdout: (text) => {
      stdout += text;
    },
    stderr: () => {},
    cwd: root,
  };
  const code = await stopCommand([], io, BOUNDS);
  return { code, stdout };
}

/** A pid no process has: a child's, after it exited. */
function goneProcess(): number {
  const child = spawnSync(process.execPath, ["-e", "console.log(process.pid)"], {
    encoding: "utf8",
  });
  return Number.parseInt(child.stdout, 10);
}

/** A process carrying `mark` as a test worker's child does, exiting after `ms`. */
function carrier(mark: string, ms: number): ChildProcess {
  const child = spawn(process.execPath, ["-e", `setTimeout(() => {}, ${ms})`], {
    env: { ...process.env, SQUEAL_DAEMON_CHILD: mark },
    stdio: "ignore",
  });
  children.push(child);
  return child;
}

describe("squeal stop past its bound (task 001-367, D10)", () => {
  it("exits 1 and names the daemon when it still serves after the bound", async () => {
    const r = squealRepo();
    await fakeDaemon(process.pid, 1, false, r.worktreeId);
    const stopped = await stop(r.root);
    expect(stopped.code).toBe(1);
    expect(stopped.stdout).toBe(
      `Stop requested; the daemon for ${r.root} (pid ${process.pid}) still serves after 0.4 s\n`,
    );
  });

  it("exits 1 and names a process carrying the daemon's mark still running after the bound", async () => {
    const r = squealRepo();
    r.store.worktrees.setDaemon(r.worktreeId as WorktreeId, {
      socketPath: socketPathFor(r.worktreeId as WorktreeId),
      startedAt: 42,
      heartbeatAt: Date.now(),
      heartbeatIntervalMs: 5_000,
      squealVersion: "0.0.0-test",
      token: "token-001-367",
    });
    const left = carrier("token-001-367:vitest", 60_000);
    // Another daemon's carrier is never waited for.
    carrier("token-other:vitest", 60_000);
    await fakeDaemon(goneProcess(), 42, true, r.worktreeId);
    await waitForPid(left);
    const stopped = await stop(r.root);
    expect(stopped.code).toBe(1);
    expect(stopped.stdout).toMatch(
      new RegExp(
        `^Stop requested; the daemon for ${literal(r.root)} stopped, but a process it started still runs after 0\\.4 s: pid ${left.pid} .*setTimeout`,
      ),
    );
  });

  it("exits 0 once the daemon's last carrier is gone", async () => {
    const r = squealRepo();
    r.store.worktrees.setDaemon(r.worktreeId as WorktreeId, {
      socketPath: socketPathFor(r.worktreeId as WorktreeId),
      startedAt: 43,
      heartbeatAt: Date.now(),
      heartbeatIntervalMs: 5_000,
      squealVersion: "0.0.0-test",
      token: "token-001-367-b",
    });
    const left = carrier("token-001-367-b", 200);
    await fakeDaemon(goneProcess(), 43, true, r.worktreeId);
    await waitForPid(left);
    const stopped = await stopCommand([], quiet(r.root), { ...BOUNDS, leftoversMs: 30_000 });
    expect(stopped).toBe(0);
  });
});

function quiet(root: string): CliIo {
  return { stdout: () => {}, stderr: () => {}, cwd: root };
}

async function waitForPid(child: ChildProcess): Promise<void> {
  if (child.pid !== undefined) return;
  await new Promise((resolve) => child.once("spawn", resolve));
}

function literal(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
