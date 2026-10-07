import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { daemonLiveness } from "../delivery/liveness.js";
import { resolveCommonDir, worktreeIdFor } from "../fs/index.js";
import { isStoreOpenFailure, openStore } from "../store/open.js";
import { storePaths } from "../store/paths.js";
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

/** The socket to ask for a worktree's daemon, and what it answered there. */
export interface DaemonLocation {
  readonly socketPath: AbsolutePath;
  readonly probe: DaemonProbe;
}

/**
 * Pings the daemon of the worktree at `root`, through `locateDaemon`. Never
 * rejects: a root that gives no socket path is `unresponsive`.
 */
export async function probeDaemon(
  root: AbsolutePath,
  timeoutMs: number,
  options: ProbeOptions & { readonly env?: NodeJS.ProcessEnv } = {},
): Promise<DaemonProbe> {
  try {
    return (await locateDaemon(root, timeoutMs, options)).probe;
  } catch (error) {
    return { state: "unresponsive", reason: `no worktree at ${root}: ${String(error)}` };
  }
}

/**
 * The one rule for which socket serves the worktree at `root`, for hooks
 * and the CLI alike (task 001-71). Review wave 3, S8: the socket the daemon
 * recorded in the store is asked first while its heartbeat is fresh, since a
 * daemon started from another environment may listen elsewhere; then the
 * socket in this environment's runtime dir (spec 001 D1). An unresponsive
 * recorded socket is the answer: that daemon holds the lock. With no daemon
 * on either, the computed socket, where a new daemon binds. Throws only when
 * `root` gives no socket path; never takes longer than twice `timeoutMs`
 * plus the connects.
 */
export async function locateDaemon(
  root: AbsolutePath,
  timeoutMs: number,
  options: ProbeOptions & { readonly env?: NodeJS.ProcessEnv } = {},
): Promise<DaemonLocation> {
  const socketPath = socketPathFor(worktreeIdFor(root), options.env);
  const record = options.record === undefined ? recordedDaemon(root) : options.record;
  const now = options.now ?? Date.now;
  if (
    record !== null &&
    record.socketPath !== socketPath &&
    daemonLiveness(record, now()).state === "alive"
  ) {
    const probe = await ping(record.socketPath, timeoutMs);
    if (probe.state !== "absent") return { socketPath: record.socketPath, probe };
  }
  return { socketPath, probe: await ping(socketPath, timeoutMs) };
}

async function ping(socketPath: AbsolutePath, timeoutMs: number): Promise<DaemonProbe> {
  try {
    const response = await requestDaemon(socketPath, { type: "ping" }, timeoutMs);
    if (response.ok && response.type === "ping") return { state: "alive", ping: response };
    return { state: "unresponsive", reason: `unexpected answer: ${JSON.stringify(response)}` };
  } catch (error) {
    const code = noDaemonCode(error);
    if (code !== null) return { state: "absent", code };
    return { state: "unresponsive", reason: (error as Error).message };
  }
}

/**
 * The code of a socket error that means no daemon listens: `ENOENT` (no
 * socket file) or `ECONNREFUSED` (nobody accepting); `null` for any other.
 */
export function noDaemonCode(error: unknown): "ENOENT" | "ECONNREFUSED" | null {
  const code = (error as DaemonRequestError | null)?.code;
  return code === "ENOENT" || code === "ECONNREFUSED" ? code : null;
}

/**
 * The daemon record of the worktree at `root`; `null` without a store, a row
 * or a record, or when the store stays busy past `busyTimeoutMs`.
 */
export function recordedDaemon(root: AbsolutePath, busyTimeoutMs = 100): DaemonRecord | null {
  try {
    const commonDir = resolveCommonDir(root);
    if (commonDir === null) return null;
    const store = openStore(commonDir, { create: false, busyTimeoutMs });
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
 * Its working directory is the store directory, never the root, so a
 * harness can remove the worktree under a live daemon (D10, lessons defect
 * 13); the daemon takes its own temp directory once it holds the lock.
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
    const commonDir = resolveCommonDir(root);
    if (commonDir === null) return "unavailable";
    const cwd = storePaths(commonDir).dir;
    mkdirSync(cwd, { recursive: true });
    const child = spawn(process.execPath, [cli, "daemon", root], {
      cwd,
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
