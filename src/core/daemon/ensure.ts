import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { daemonLiveness } from "../delivery/liveness.js";
import { isStoreOpenFailure, openStore } from "../store/open.js";
import { resolveCommonDir, worktreeIdFor } from "../store/paths.js";
import {
  type AbsolutePath,
  DAEMON_SOCKET_TIMEOUT_MS,
  type DaemonProbe,
  type DaemonRecord,
  type EnsureDaemonResult,
} from "../types/index.js";
import { type DaemonRequestError, requestDaemon } from "./client.js";
import { socketPathFor } from "./paths.js";

/*
 * Entry points for hooks (task 001-31): only `node:` modules and small
 * Squeal modules are imported, so a hook pays for Node's start and little
 * else.
 */

export interface ProbeOptions {
  /**
   * The worktree's daemon record, when the caller has read it already.
   * `undefined`: read from the store; `null`: none recorded.
   */
  readonly record?: DaemonRecord | null;
  readonly now?: () => number;
}

export interface EnsureDaemonOptions extends ProbeOptions {
  /**
   * The `squeal` CLI script to spawn as `node <cli> daemon <root>`. Review
   * wave 3, B1: each caller passes the CLI it ships (a hook bundle the CLI
   * bundle beside it, `squeal start` itself). `SQUEAL_CLI` overrides it, for
   * tests; with neither, nothing is spawned.
   */
  readonly cli?: AbsolutePath;
  readonly socketTimeoutMs?: number;
  /** Default `process.env`: `SQUEAL_CLI` and the runtime dir of the socket. */
  readonly env?: NodeJS.ProcessEnv;
}

/**
 * Pings the daemon of the worktree at `root`. Review wave 3, S8: the socket
 * the daemon recorded in the store is asked first while its heartbeat is
 * fresh, since a daemon started from another environment may listen
 * elsewhere; then the socket in this environment's runtime dir (spec 001
 * D1). An unresponsive recorded socket is the answer: that daemon holds the
 * lock. Never rejects and never takes longer than twice `timeoutMs` plus
 * the connects.
 */
export async function probeDaemon(
  root: AbsolutePath,
  timeoutMs: number,
  options: ProbeOptions & { readonly env?: NodeJS.ProcessEnv } = {},
): Promise<DaemonProbe> {
  let socketPath: AbsolutePath;
  try {
    socketPath = socketPathFor(worktreeIdFor(root), options.env);
  } catch (error) {
    return { state: "unresponsive", reason: `no worktree at ${root}: ${String(error)}` };
  }
  const record = options.record === undefined ? recordedDaemon(root) : options.record;
  const now = options.now ?? Date.now;
  if (
    record !== null &&
    record.socketPath !== socketPath &&
    daemonLiveness(record, now()).state === "alive"
  ) {
    const recorded = await ping(record.socketPath, timeoutMs);
    if (recorded.state !== "absent") return recorded;
  }
  return ping(socketPath, timeoutMs);
}

async function ping(socketPath: AbsolutePath, timeoutMs: number): Promise<DaemonProbe> {
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

/** The daemon record of the worktree at `root`; `null` without a store, a row or a record. */
function recordedDaemon(root: AbsolutePath): DaemonRecord | null {
  try {
    const commonDir = resolveCommonDir(root);
    if (commonDir === null) return null;
    const store = openStore(commonDir, { create: false, busyTimeoutMs: 100 });
    if (isStoreOpenFailure(store)) return null;
    try {
      return store.worktrees.get(worktreeIdFor(root))?.daemon ?? null;
    } finally {
      store.close();
    }
  } catch {
    return null;
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
 * additions", D11). `<cli>` is `SQUEAL_CLI` when set, else `options.cli`.
 */
export async function ensureDaemon(
  root: AbsolutePath,
  options: EnsureDaemonOptions = {},
): Promise<EnsureDaemonResult> {
  const probe = await probeDaemon(
    root,
    options.socketTimeoutMs ?? DAEMON_SOCKET_TIMEOUT_MS,
    options,
  );
  if (probe.state === "alive") return "alive";
  if (probe.state === "unresponsive") return "unavailable";
  const cli = daemonCliEntry(options.cli, options.env);
  if (cli === null || !existsSync(cli)) return "unavailable";
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

/** The `squeal` CLI script the daemon is spawned from: `SQUEAL_CLI`, else `cli`, else `null`. */
export function daemonCliEntry(
  cli?: AbsolutePath,
  env: NodeJS.ProcessEnv = process.env,
): AbsolutePath | null {
  const override = env.SQUEAL_CLI;
  if (override !== undefined && override !== "") return override;
  return cli ?? null;
}
