import { requestDaemon } from "../core/daemon/client.js";
import { socketPathFor } from "../core/daemon/paths.js";
import { findWorktreeRoot, resolveCommonDir, worktreeIdFor } from "../core/fs/index.js";
import { isStoreOpenFailure, openStore } from "../core/store/index.js";
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
 * The daemon socket of a worktree: the path its daemon recorded in the store
 * (D10), else the one this environment's runtime dir gives (D1).
 */
export function daemonSocket(root: AbsolutePath): AbsolutePath {
  const worktreeId = worktreeIdFor(root);
  const commonDir = resolveCommonDir(root);
  if (commonDir !== null) {
    const store = openStore(commonDir, { create: false, busyTimeoutMs: 1_000 });
    if (!isStoreOpenFailure(store)) {
      try {
        const recorded = store.worktrees.get(worktreeId)?.daemon?.socketPath;
        if (recorded !== undefined) return recorded;
      } catch {
        // An unreadable record falls back to the computed path.
      } finally {
        store.close();
      }
    }
  }
  return socketPathFor(worktreeId);
}

/** Sends a request; `null` when no daemon listens (`ENOENT`, `ECONNREFUSED`). Other errors throw. */
export async function askDaemon(
  socketPath: AbsolutePath,
  request: DaemonRequest,
): Promise<DaemonResponse | null> {
  try {
    return await requestDaemon(socketPath, request, CLI_SOCKET_TIMEOUT_MS);
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    if (code === "ENOENT" || code === "ECONNREFUSED") return null;
    throw error;
  }
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
