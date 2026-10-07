import { findWorktreeRoot, resolveCommonDir } from "../fs/index.js";
import { isStoreOpenFailure, openStore, storePaths } from "../store/index.js";
import {
  type AbsolutePath,
  PAYLOAD_SCHEMA_VERSION,
  type StatusUnavailable,
  type Store,
} from "../types/index.js";

/** Spec 001 D9 and goal 6: status never stalls; one busy timeout bounds every read. */
export const STATUS_BUSY_TIMEOUT_MS = 1_000;

export interface StatusStoreOptions {
  /** Busy timeout of the read connection. Default `STATUS_BUSY_TIMEOUT_MS`. */
  readonly busyTimeoutMs?: number;
}

/** An open store and the worktree a status read is about. */
export interface StatusContext {
  readonly store: Store;
  readonly root: AbsolutePath;
}

export { findWorktreeRoot };

export function unavailable(
  reason: StatusUnavailable["reason"],
  detail: string,
): StatusUnavailable {
  return {
    schemaVersion: PAYLOAD_SCHEMA_VERSION,
    available: false,
    reason,
    message: `status unavailable, ${detail}`,
  };
}

/**
 * Opens the store of the worktree containing `cwd` for reading and runs `fn`.
 * Never creates the store and never runs `integrity_check` (that is daemon
 * start, D12). Every failure becomes a `StatusUnavailable`: missing store,
 * newer schema (D8), unreadable file, or a lock held past the busy timeout.
 */
export function withStatusStore<T>(
  cwd: AbsolutePath,
  options: StatusStoreOptions,
  fn: (context: StatusContext) => T,
): T | StatusUnavailable {
  const root = findWorktreeRoot(cwd);
  const commonDir = root === null ? null : resolveCommonDir(root);
  if (root === null || commonDir === null) {
    return unavailable("no-store", `${cwd} is not inside a git worktree`);
  }
  const busyTimeoutMs = options.busyTimeoutMs ?? STATUS_BUSY_TIMEOUT_MS;
  let store: Store | undefined;
  try {
    const opened = openStore(commonDir, { create: false, busyTimeoutMs });
    if (isStoreOpenFailure(opened)) {
      switch (opened.reason) {
        case "missing":
          return unavailable("no-store", `no Squeal store at ${storePaths(commonDir).database}`);
        case "newer-schema":
          return unavailable(
            "store-newer",
            `store version newer than this Squeal (store ${opened.found}, supported ${opened.supported})`,
          );
        case "corrupt":
          return unavailable(
            "store-unreadable",
            `store at ${storePaths(commonDir).database} is corrupt`,
          );
      }
    }
    store = opened;
    return fn({ store, root });
  } catch (error) {
    if (isBusy(error)) {
      return unavailable("timeout", `store busy for more than ${busyTimeoutMs} ms`);
    }
    return unavailable("store-unreadable", `store unreadable: ${String(error)}`);
  } finally {
    store?.close();
  }
}

/** SQLITE_BUSY (5) and SQLITE_LOCKED (6), including extended codes. */
function isBusy(error: unknown): boolean {
  const code = (error as { errcode?: unknown } | null)?.errcode;
  return typeof code === "number" && [5, 6].includes(code & 0xff);
}
