import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Connection } from "../../store/connection.js";
import { DEFAULT_BUSY_TIMEOUT_MS, switchToWal } from "../../store/open.js";
import { storePaths } from "../../store/paths.js";
import { migrate, userVersion } from "../../store/schema.js";
import type { AbsolutePath, Policy } from "../../types/index.js";
import { CODE_MIGRATIONS, CODE_SCHEMA_VERSION } from "./schema.js";
import { createCodeStore } from "./store.js";
import type { CodeStore, CodeStoreOpenFailure } from "./types.js";

export interface OpenCodeStoreOptions {
  /**
   * Create the file when it does not exist. Default `true`, for the daemon.
   * `status`, `squeal code` and hooks pass `false`: they read, and a missing
   * file is `{ reason: "missing" }`.
   */
  readonly create?: boolean;
  /** Busy timeout for this connection. Default `DEFAULT_BUSY_TIMEOUT_MS`, as the main store. */
  readonly busyTimeoutMs?: number;
}

/** Spec 015 D4: `<common-dir>/squeal/code.sqlite`, beside the main store. */
export function codeStorePath(commonDir: AbsolutePath): AbsolutePath {
  return join(storePaths(commonDir).dir, "code.sqlite");
}

export function isCodeStoreOpenFailure(
  value: CodeStore | CodeStoreOpenFailure,
): value is CodeStoreOpenFailure {
  return "reason" in value;
}

/**
 * Opens the code store (spec 015 D4) only while `complexity.enabled` holds:
 * with it off nothing on disk is touched (goal 1). The main store's
 * connection rules apply (011 C7): WAL, `synchronous=NORMAL`, a busy timeout,
 * and migrations up to `CODE_SCHEMA_VERSION` in one `BEGIN IMMEDIATE` that
 * re-reads the version, so concurrent openers migrate once. Opening a
 * current file takes no write lock. A newer `user_version` is refused
 * without touching the file; a corrupt file is reported, never moved.
 */
export function openCodeStore(
  commonDir: AbsolutePath,
  policy: Pick<Policy, "complexity">,
  options: OpenCodeStoreOptions = {},
): CodeStore | CodeStoreOpenFailure {
  if (!policy.complexity.enabled) return { reason: "off" };
  const path = codeStorePath(commonDir);
  if (!existsSync(path)) {
    if (options.create === false) return { reason: "missing" };
    mkdirSync(storePaths(commonDir).dir, { recursive: true });
  }
  const busyTimeoutMs = options.busyTimeoutMs ?? DEFAULT_BUSY_TIMEOUT_MS;
  if (!Number.isInteger(busyTimeoutMs) || busyTimeoutMs < 0) {
    throw new RangeError(`busyTimeoutMs must be >= 0: ${busyTimeoutMs}`);
  }
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(path);
    db.exec(`PRAGMA busy_timeout = ${busyTimeoutMs}`);
    const found = userVersion(db);
    if (found > CODE_SCHEMA_VERSION) {
      db.close();
      return { reason: "newer-schema", found, supported: CODE_SCHEMA_VERSION };
    }
    // Takes effect only before the first table exists, so only on a new file (task 001-141).
    if (Number(db.prepare("PRAGMA page_count").get()?.page_count) === 0) {
      db.exec("PRAGMA auto_vacuum = INCREMENTAL");
    }
    switchToWal(db, busyTimeoutMs);
    db.exec("PRAGMA synchronous = NORMAL");
    const version = migrate(db, CODE_MIGRATIONS);
    return createCodeStore(new Connection(db), version, path);
  } catch (error) {
    db?.close();
    if (isCorruption(error)) return { reason: "corrupt", error: String(error) };
    throw error;
  }
}

/** SQLITE_CORRUPT (11) and SQLITE_NOTADB (26), including extended codes. */
function isCorruption(error: unknown): boolean {
  const code = (error as { errcode?: unknown }).errcode;
  return typeof code === "number" && [11, 26].includes(code & 0xff);
}
