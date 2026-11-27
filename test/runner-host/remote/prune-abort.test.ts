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
import { type AddressInfo, createServer as createTcpServer, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, onTestFinished, vi } from "vitest";
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

/**
 * Review 0.1.659-r2 B1: a loopback proxy that reads each `CONNECT` and
 * either never answers it, or answers 200 and then never speaks, so the
 * TLS handshake through the tunnel stays pending. It counts open sockets.
 */
async function stalledProxy(answer: "never" | "then-silent") {
  const sockets = new Set<Socket>();
  const connects: string[] = [];
  let after = 0;
  const server = createTcpServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => {});
    let head = "";
    socket.on("data", (chunk: Buffer) => {
      if (head.includes("\r\n\r\n")) {
        after += chunk.length;
        return;
      }
      head += chunk.toString("latin1");
      if (!head.includes("\r\n\r\n")) return;
      connects.push(head.split("\r\n")[0] ?? "");
      if (answer === "then-silent") socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
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
    connects,
    /** Bytes the client sent after its `CONNECT`: its TLS hello, once the tunnel is open. */
    after: () => after,
    open: () => sockets.size,
  };
}

/** From now on, the timers set and neither fired nor cleared yet. */
function liveTimers(): Set<unknown> {
  const live = new Set<unknown>();
  const set = globalThis.setTimeout;
  const clear = globalThis.clearTimeout;
  vi.spyOn(globalThis, "setTimeout").mockImplementation(((
    run: (...args: unknown[]) => void,
    ms?: number,
    ...args: unknown[]
  ) => {
    const timer = set(() => {
      live.delete(timer);
      run(...args);
    }, ms);
    live.add(timer);
    return timer;
  }) as typeof setTimeout);
  vi.spyOn(globalThis, "clearTimeout").mockImplementation((timer) => {
    live.delete(timer);
    clear(timer);
  });
  onTestFinished(() => {
    vi.restoreAllMocks();
  });
  return live;
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

  for (const answer of ["never", "then-silent"] as const) {
    const phase = answer === "never" ? "a proxy CONNECT" : "a TLS handshake through the proxy";
    it(`closes ${phase} left pending, clears its deadline and keeps the record (review 0.1.659-r2 B1)`, async () => {
      const proxy = await stalledProxy(answer);
      const u = user(
        { provider: "agent37", providerConfig: { apiBaseUrl: "https://api.agent37.invalid" } },
        {
          provider: "agent37",
          id: "agent37:eu:vm:inst0proxy",
          state: { instanceId: "inst0proxy", region: "eu", type: "vm", bootstrap: "git-bundle" },
        },
      );
      u.env.HTTPS_PROXY = proxy.url;
      const live = liveTimers();
      const stop = new AbortController();
      const pruning = pruneRemovedWorktrees({ env: u.env, signal: stop.signal });
      await waitFor(() => proxy.connects.length === 1, 10_000, "the CONNECT sent");
      expect(proxy.connects).toEqual(["CONNECT api.agent37.invalid:443 HTTP/1.1"]);
      if (answer === "then-silent") {
        await waitFor(() => proxy.after() > 0, 5_000, "the TLS hello through the tunnel");
      }
      stop.abort();
      expect(await pruning).toMatchObject({ gone: 1, outcomes: [], aborted: true });
      await waitFor(() => proxy.open() === 0, 3_000, "the proxy's socket closed");
      expect(live.size).toBe(0);
      expect(readMachines(u.env).machines.map((m) => m.id)).toEqual(["agent37:eu:vm:inst0proxy"]);
    }, 20_000);
  }
});
