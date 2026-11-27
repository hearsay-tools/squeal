import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo, Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import {
  readMachines,
  recordMachine,
} from "../../../src/core/runner-host/remote/machines-store.js";
import type { MachineRecord } from "../../../src/core/runner-host/remote/provider.js";
import { pruneRemovedWorktrees } from "../../../src/core/runner-host/remote/prune.js";
import { remoteSettingsPath } from "../../../src/core/runner-host/remote/settings.js";
import type { AbsolutePath, WorktreeId } from "../../../src/core/types/common.js";

/*
 * Review 0.1.658 B1: the prune's abort ends the provider's own release,
 * not only the prune's wait for it. The built-in providers run for real:
 * Agent37's DELETE goes to a loopback server that never answers, and the
 * command provider's release hook is a real child process that never
 * exits. After the abort the socket is closed and the hook killed, and
 * the record stays tracked for the next prune.
 */

/** A user whose `remote.json` names `lane` for `/repo`, and one tracked machine of a removed worktree. */
function user(lane: Record<string, unknown>, record: Partial<MachineRecord>) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "squeal-prune-abort-")));
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
  const env: NodeJS.ProcessEnv = {
    XDG_CONFIG_HOME: join(dir, "config"),
    XDG_STATE_HOME: join(dir, "state"),
    HOME: join(dir, "home"),
    PATH: process.env.PATH,
    AGENT37_API_KEY: "sk_test_prune_abort_5d1e",
  };
  mkdirSync(join(dir, "config", "squeal"), { recursive: true });
  writeFileSync(remoteSettingsPath(env), JSON.stringify({ repositories: { "/repo": lane } }));
  recordMachine(
    {
      worktreeId: "w1" as WorktreeId,
      worktreeRoot: join(dir, "removed") as AbsolutePath,
      repositoryKey: "/repo",
      destination: "dev@host",
      sshArgs: [],
      places: { node: "node", cache: "c" },
      capabilities: { hasGitRepository: false, sleepOnIdle: true, ephemeralHostKey: false },
      status: "detached",
      createdAt: 1,
      lastUsedAt: 2,
      ...record,
    } as MachineRecord,
    env,
  );
  return { dir, env };
}

/** A server that takes each request and never answers; it counts open and closed sockets. */
async function silentServer() {
  const sockets = new Set<Socket>();
  const seen: string[] = [];
  let closed = 0;
  const server: Server = createServer((request) => {
    seen.push(`${request.method} ${request.url}`);
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => {
      sockets.delete(socket);
      closed++;
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  onTestFinished(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => server.close(resolve));
  });
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    seen,
    open: () => sockets.size,
    closed: () => closed,
  };
}

async function waitFor(check: () => boolean, timeoutMs: number, what: string): Promise<void> {
  const started = Date.now();
  while (!check()) {
    if (Date.now() - started > timeoutMs) throw new Error(`${what} not met in ${timeoutMs} ms`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe("the prune's abort ends the provider's release (review 0.1.658 B1)", () => {
  it("closes Agent37's pending DELETE and keeps the record", async () => {
    const api = await silentServer();
    const u = user(
      { provider: "agent37", providerConfig: { apiBaseUrl: api.url } },
      {
        provider: "agent37",
        id: "agent37:eu:vm:inst0abort",
        state: { instanceId: "inst0abort", region: "eu", type: "vm", bootstrap: "git-bundle" },
      },
    );
    const stop = new AbortController();
    const pruning = pruneRemovedWorktrees({ env: u.env, signal: stop.signal });
    await waitFor(() => api.seen.length === 1, 10_000, "the DELETE sent");
    expect(api.seen).toEqual(["DELETE /v1/instances/inst0abort"]);
    stop.abort();
    expect(await pruning).toMatchObject({ gone: 1, outcomes: [], aborted: true });
    await waitFor(() => api.closed() === 1, 5_000, "the DELETE's socket closed");
    expect(api.open()).toBe(0);
    expect(readMachines(u.env).machines.map((m) => m.id)).toEqual(["agent37:eu:vm:inst0abort"]);
  });

  it("kills the command provider's release hook and keeps the record", async () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "squeal-prune-hook-")));
    onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
    const pidFile = join(dir, "hook.pid");
    const hook = join(dir, "release-hook.mjs");
    writeFileSync(
      hook,
      `import { writeFileSync } from "node:fs";\nwriteFileSync(${JSON.stringify(pidFile)}, String(process.pid));\nsetInterval(() => {}, 1000);\n`,
    );
    const u = user(
      {
        provider: "command",
        providerConfig: { acquire: ["unused"], release: [process.execPath, hook] },
      },
      { provider: "command", id: "cmd:hook" },
    );
    const stop = new AbortController();
    const pruning = pruneRemovedWorktrees({ env: u.env, signal: stop.signal });
    await waitFor(
      () => existsSync(pidFile) && readFileSync(pidFile, "utf8") !== "",
      10_000,
      "the hook started",
    );
    const pid = Number(readFileSync(pidFile, "utf8"));
    onTestFinished(() => {
      if (alive(pid)) process.kill(pid, "SIGKILL");
    });
    expect(alive(pid)).toBe(true);
    stop.abort();
    expect(await pruning).toMatchObject({ gone: 1, outcomes: [], aborted: true });
    await waitFor(() => !alive(pid), 5_000, "the hook killed");
    expect(readMachines(u.env).machines.map((m) => m.id)).toEqual(["cmd:hook"]);
  });
});
