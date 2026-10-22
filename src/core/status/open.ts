import { findWorktreeRoot, resolveCommonDir } from "../fs/index.js";
import {
  isBusy,
  isStoreOpenFailure,
  openStore,
  readTransaction,
  storePaths,
} from "../store/index.js";
import {
  type AbsolutePath,
  PAYLOAD_SCHEMA_VERSION,
  type StatusUnavailable,
  type Store,
} from "../types/index.js";

/** Spec 001 D9 and goal 6: status never stalls; one busy timeout bounds every read. */
export const STATUS_BUSY_TIMEOUT_MS = 1_000;

/**
 * Row 011-01, issue 8: how long a CLI read (`status`, `why`, `failures`)
 * keeps trying a busy store before it says it is unavailable. A CLI query is
 * not a hook, so goal 6's budget does not bind it; other reads keep their
 * busy timeout as the bound.
 */
export const CLI_READ_RETRY_MS = 5_000;

/** The pause between two attempts, so a lock that fails a read at once is not spun on. */
const BUSY_RETRY_PAUSE_MS = 50;

export interface StatusStoreOptions {
  /** Busy timeout of the read connection. Default `STATUS_BUSY_TIMEOUT_MS`. */
  readonly busyTimeoutMs?: number;
  /**
   * How long to keep trying a busy store, each attempt with the busy timeout.
   * Default the busy timeout: SQLite answers some reads busy at once, without
   * its busy handler, so even one timeout's bound is waited out by trying
   * again (row 011-113). The CLI's reads pass `CLI_READ_RETRY_MS`.
   */
  readonly busyRetryMs?: number;
}

/** An open store and the worktree a status read is about. */
export interface StatusContext {
  readonly store: Store;
  readonly root: AbsolutePath;
  /** The git common dir, which holds the store. */
  readonly commonDir: AbsolutePath;
}

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
 * start, D12). `fn` runs in one read transaction, so it sees one committed
 * state of the store (lessons defect 23). Every failure becomes a `StatusUnavailable`: missing store,
 * newer schema (D8), unreadable file, or a lock held past the busy timeout
 * and `busyRetryMs`, whose message says how long it waited. Each attempt
 * opens the store again, so a retry reads in a new read transaction.
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
  const retryMs = options.busyRetryMs ?? busyTimeoutMs;
  const started = Date.now();
  for (;;) {
    // An attempt's busy timeout never outlasts what is left of `busyRetryMs`, so the bound holds.
    const left = retryMs - (Date.now() - started);
    const attemptMs = retryMs > 0 ? Math.max(1, Math.min(busyTimeoutMs, left)) : busyTimeoutMs;
    const read = readOnce(root, commonDir, attemptMs, fn);
    if (read !== BUSY) return read;
    const waited = Date.now() - started;
    if (waited >= retryMs) {
      return unavailable(
        "timeout",
        `store busy, waited ${waited} ms: another process holds the store's lock; run the command again once it is released`,
      );
    }
    Atomics.wait(SLEEP, 0, 0, Math.min(BUSY_RETRY_PAUSE_MS, retryMs - waited));
  }
}

const BUSY = Symbol("busy");
const SLEEP = new Int32Array(new SharedArrayBuffer(4));

function readOnce<T>(
  root: AbsolutePath,
  commonDir: AbsolutePath,
  busyTimeoutMs: number,
  fn: (context: StatusContext) => T,
): T | StatusUnavailable | typeof BUSY {
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
    const context = { store, root, commonDir };
    return readTransaction(store, () => fn(context));
  } catch (error) {
    if (isBusy(error)) return BUSY;
    return unavailable("store-unreadable", `store unreadable: ${String(error)}`);
  } finally {
    store?.close();
  }
}
