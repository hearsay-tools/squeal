import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { EnsureDaemonOptions } from "../../../src/core/daemon/ensure.js";
import { worktreeIdFor } from "../../../src/core/fs/index.js";
import { keepOnSpawn } from "../../../src/harness/codex/kept.js";
import type { HookDeps } from "../../../src/harness/shared/hook.js";
import { tempDir } from "../../store/helpers.js";
import { liveSocket, runtimeDir } from "../bundle-helpers.js";

/*
 * Row 005-81: before its version's copy exists, a Codex hook other than
 * SessionStart keeps the copy only on the way to a spawn, and spawns from it.
 * The bundle test `version-copies-hook.test.ts` shows the daemon's command line.
 */

const V = "0.1.900";
type Options = EnsureDaemonOptions & { readonly socketTimeoutMs: number };

const servers: Server[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.close();
});

/** A socket that answers the probe's ping as a live daemon does. */
function answering(path: string): Promise<void> {
  const ping = { schemaVersion: 1, ok: true, type: "ping", pid: process.pid, phase: "ready" };
  return new Promise((resolve) => {
    const server = createServer((socket) => {
      socket.once("data", () => socket.end(`${JSON.stringify(ping)}\n`));
    });
    servers.push(server);
    server.listen(path, () => resolve());
  });
}

/** A plugin root in Codex's layout, its data directory, a worktree and a runtime dir. */
function fixture(version = V) {
  const root = tempDir("squeal-kept-root-");
  const cache = join(root, "dist", "cli", "squeal.mjs");
  mkdirSync(join(root, "dist", "cli"), { recursive: true });
  writeFileSync(cache, "// the cache's CLI\n");
  // Row 011-140: the root's manifest names the version a copy of it holds.
  mkdirSync(join(root, ".codex-plugin"));
  writeFileSync(join(root, ".codex-plugin", "plugin.json"), JSON.stringify({ version }));
  const data = join(tempDir("squeal-kept-data-"), "squeal-hearsay");
  const worktree = tempDir("squeal-kept-worktree-");
  const runtime = runtimeDir();
  const spawned: Options[] = [];
  const deps: HookDeps = {
    env: { PLUGIN_ROOT: root, PLUGIN_DATA: data },
    cli: cache,
    squealVersion: version,
    ensureDaemon: (_root, options) => {
      spawned.push(options);
      return Promise.resolve("spawned");
    },
  };
  const options: Options = {
    socketTimeoutMs: 100,
    cli: cache,
    record: null,
    env: { XDG_RUNTIME_DIR: runtime },
  };
  const copy = join(data, "versions", version, "dist", "cli", "squeal.mjs");
  const socket = join(runtime, `squeal-${worktreeIdFor(worktree)}.sock`);
  return { root, cache, data, worktree, deps, options, spawned, copy, socket };
}

describe("keepOnSpawn (005-81)", () => {
  it("keeps the copy and spawns from it when no daemon answers", async () => {
    const f = fixture();
    const ensure = keepOnSpawn(f.deps).ensureDaemon;
    expect(await ensure?.(f.worktree, f.options)).toBe("spawned");
    expect(f.spawned.map((o) => o.cli)).toEqual([f.copy]);
    expect(existsSync(f.copy)).toBe(true);
  });

  it("copies nothing and spawns nothing when the daemon answers", async () => {
    const f = fixture();
    await answering(f.socket);
    const ensure = keepOnSpawn(f.deps).ensureDaemon;
    expect(await ensure?.(f.worktree, f.options)).toBe("alive");
    expect(f.spawned).toEqual([]);
    expect(existsSync(f.data)).toBe(false);
  });

  it("copies nothing and spawns nothing when a daemon holds the socket and does not answer", async () => {
    const f = fixture();
    await liveSocket(f.socket);
    const ensure = keepOnSpawn(f.deps).ensureDaemon;
    expect(await ensure?.(f.worktree, f.options)).toBe("unavailable");
    expect(f.spawned).toEqual([]);
    expect(existsSync(f.data)).toBe(false);
  });

  it("keeps the copy for a successor after a handoff, which spawns while the old daemon answers", async () => {
    const f = fixture();
    await liveSocket(f.socket);
    const ensure = keepOnSpawn(f.deps).ensureDaemon;
    expect(await ensure?.(f.worktree, { ...f.options, awaitLockMs: 5_000 })).toBe("spawned");
    expect(f.spawned.map((o) => [o.cli, o.awaitLockMs])).toEqual([[f.copy, 5_000]]);
  });

  it("spawns from the cache when no copy can be made", async () => {
    const f = fixture("0.0.0-unknown");
    const ensure = keepOnSpawn(f.deps).ensureDaemon;
    expect(await ensure?.(f.worktree, f.options)).toBe("spawned");
    expect(f.spawned.map((o) => o.cli)).toEqual([f.cache]);
    expect(existsSync(f.data)).toBe(false);
  });

  it("leaves the hook's deps as they are once a copy exists, or without PLUGIN_ROOT or PLUGIN_DATA", async () => {
    const f = fixture();
    const { PLUGIN_ROOT, PLUGIN_DATA } = f.deps.env;
    for (const env of [{ PLUGIN_ROOT }, { PLUGIN_DATA }, { PLUGIN_ROOT, PLUGIN_DATA: "" }]) {
      const deps = { ...f.deps, env };
      expect(keepOnSpawn(deps)).toBe(deps);
    }
    await keepOnSpawn(f.deps).ensureDaemon?.(f.worktree, f.options);
    expect(keepOnSpawn(f.deps)).toBe(f.deps);
  });
});
