import { requestDaemon } from "../core/daemon/client.js";
import { locateDaemon, noDaemonCode, recordedDaemon } from "../core/daemon/ensure.js";
import { findWorktreeRoot } from "../core/fs/index.js";
import type { AbsolutePath, DaemonRequest, DaemonResponse } from "../core/types/index.js";
import type { CliIo } from "./main.js";

/** A CLI is not a hook: it may wait longer than 100 ms for an answer. */
export const CLI_SOCKET_TIMEOUT_MS = 2_000;

/** The worktree root containing `path` (default the CLI's cwd), or `null` after printing why not. */
export function worktreeRoot(path: string | undefined, io: CliIo): AbsolutePath | null {
  const from = path ?? io.cwd ?? process.cwd();
  const root = findWorktreeRoot(from);
  if (root === null) io.stderr(`squeal: ${from} is not inside a git worktree\n`);
  return root;
}

/**
 * The daemon socket of a worktree, by the rule hooks use (`locateDaemon`,
 * D1): the socket recorded in the store while its heartbeat is fresh and a
 * daemon is there, else the one this environment's runtime dir gives.
 */
export async function daemonSocket(root: AbsolutePath): Promise<AbsolutePath> {
  const record = recordedDaemon(root, 1_000);
  return (await locateDaemon(root, CLI_SOCKET_TIMEOUT_MS, { record })).socketPath;
}

/** Sends a request; `null` when no daemon listens (`ENOENT`, `ECONNREFUSED`). Other errors throw. */
export async function askDaemon(
  socketPath: AbsolutePath,
  request: DaemonRequest,
): Promise<DaemonResponse | null> {
  try {
    return await requestDaemon(socketPath, request, CLI_SOCKET_TIMEOUT_MS);
  } catch (error) {
    if (noDaemonCode(error) !== null) return null;
    throw error;
  }
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
