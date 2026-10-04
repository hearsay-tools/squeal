import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { worktreeIdFor } from "../store/paths.js";
import {
  type AbsolutePath,
  DAEMON_SOCKET_TIMEOUT_MS,
  type DaemonProbe,
  type EnsureDaemonResult,
} from "../types/index.js";
import { type DaemonRequestError, requestDaemon } from "./client.js";
import { socketPathFor } from "./paths.js";

/*
 * Entry points for hooks (task 001-31): only `node:` modules and small
 * Squeal modules are imported, so a hook pays for Node's start and little
 * else.
 */

/**
 * Pings the daemon of the worktree at `root` through its socket in the
 * runtime dir (spec 001 D1). Never rejects and never takes longer than
 * `timeoutMs` plus a connect.
 */
export async function probeDaemon(root: AbsolutePath, timeoutMs: number): Promise<DaemonProbe> {
  let socketPath: AbsolutePath;
  try {
    socketPath = socketPathFor(worktreeIdFor(root));
  } catch (error) {
    return { state: "unresponsive", reason: `no worktree at ${root}: ${String(error)}` };
  }
  try {
    const response = await requestDaemon(socketPath, { type: "ping" }, timeoutMs);
    if (response.ok && response.type === "ping") return { state: "alive", ping: response };
    return { state: "unresponsive", reason: `unexpected answer: ${JSON.stringify(response)}` };
  } catch (error) {
    const code = (error as DaemonRequestError).code;
    if (code === "ENOENT" || code === "ECONNREFUSED") return { state: "absent", code };
    return { state: "unresponsive", reason: (error as Error).message };
  }
}

/**
 * Makes sure a daemon serves the worktree at `root`, without waiting for one
 * to start.
 *
 * Spec 001 D10: "A hook that finds no live socket spawns `squeal daemon
 * <root>` detached (`detached: true`, `stdio: 'ignore'`, `unref()`), about 70
 * ms, and returns without waiting." Research: on `ENOENT` or `ECONNREFUSED`
 * spawn; a daemon that does not answer in time still holds the lock, so a
 * timeout is `unavailable`, not a reason to spawn. Several hooks spawning at
 * once is harmless: losers of the lock exit.
 *
 * The daemon runs `node <cli> daemon <root>` with the caller's Node and
 * environment ("inherits the environment of the hook that started it with no
 * additions", D11). `<cli>` is `SQUEAL_CLI` when set, else the CLI entry of
 * this package (`dist/cli/index.js`).
 */
export async function ensureDaemon(
  root: AbsolutePath,
  options?: { socketTimeoutMs?: number },
): Promise<EnsureDaemonResult> {
  const probe = await probeDaemon(root, options?.socketTimeoutMs ?? DAEMON_SOCKET_TIMEOUT_MS);
  if (probe.state === "alive") return "alive";
  if (probe.state === "unresponsive") return "unavailable";
  const cli = daemonCliEntry();
  if (!existsSync(cli)) return "unavailable";
  try {
    const child = spawn(process.execPath, [cli, "daemon", root], {
      cwd: root,
      detached: true,
      stdio: "ignore",
    });
    // A failed spawn is reported asynchronously; a hook must never crash on it.
    child.on("error", () => {});
    child.unref();
    return "spawned";
  } catch {
    return "unavailable";
  }
}

/** The `squeal` CLI script the daemon is spawned from. */
export function daemonCliEntry(env: NodeJS.ProcessEnv = process.env): AbsolutePath {
  const override = env.SQUEAL_CLI;
  if (override !== undefined && override !== "") return override;
  return fileURLToPath(new URL("../../cli/index.js", import.meta.url));
}
