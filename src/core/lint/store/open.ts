import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Connection } from "../../store/connection.js";
import { DEFAULT_BUSY_TIMEOUT_MS, isCorruption, switchToWal } from "../../store/open.js";
import { storePaths } from "../../store/paths.js";
import { migrate, userVersion } from "../../store/schema.js";
import type { AbsolutePath, Policy } from "../../types/index.js";
import { LINT_MIGRATIONS, LINT_SCHEMA_VERSION } from "./schema.js";
import { createLintStore } from "./store.js";
import type { LintStore, LintStoreOpenFailure } from "./types.js";

export interface OpenLintStoreOptions {
  /**
   * Create the file when it does not exist. Default `true`, for the daemon.
   * Readers pass `false`: a missing file is `{ reason: "missing" }`.
   */
  readonly create?: boolean;
  /** Busy timeout for this connection. Default `DEFAULT_BUSY_TIMEOUT_MS`, as the main store. */
  readonly busyTimeoutMs?: number;
}

/** Spec 017 D6: `<common-dir>/squeal/lint.sqlite`, beside the main store. */
export function lintStorePath(commonDir: AbsolutePath): AbsolutePath {
  return join(storePaths(commonDir).dir, "lint.sqlite");
}

export function isLintStoreOpenFailure(
  value: LintStore | LintStoreOpenFailure,
): value is LintStoreOpenFailure {
  return "reason" in value;
}

/**
 * Opens the lint store (spec 017 D6) only while `lint.enabled` holds: with
 * it off nothing on disk is touched (goal 1). The code store's rules apply
 * (015 D4, 011 C7): WAL, `synchronous=NORMAL`, a busy timeout, and
 * migrations up to `LINT_SCHEMA_VERSION` in one `BEGIN IMMEDIATE` that
 * re-reads the version, so concurrent openers migrate once. A newer
 * `user_version` is refused without touching the file; a corrupt file is
 * reported, never moved.
 */
export function openLintStore(
  commonDir: AbsolutePath,
  policy: Pick<Policy, "lint">,
  options: OpenLintStoreOptions = {},
): LintStore | LintStoreOpenFailure {
  if (!policy.lint.enabled) return { reason: "off" };
  const path = lintStorePath(commonDir);
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
    if (found > LINT_SCHEMA_VERSION) {
      db.close();
      return { reason: "newer-schema", found, supported: LINT_SCHEMA_VERSION };
    }
    // Takes effect only before the first table exists, so only on a new file (task 001-141).
    if (Number(db.prepare("PRAGMA page_count").get()?.page_count) === 0) {
      db.exec("PRAGMA auto_vacuum = INCREMENTAL");
    }
    switchToWal(db, busyTimeoutMs);
    db.exec("PRAGMA synchronous = NORMAL");
    const version = migrate(db, LINT_MIGRATIONS);
    return createLintStore(new Connection(db), version, path);
  } catch (error) {
    db?.close();
    if (isCorruption(error)) return { reason: "corrupt", error: String(error) };
    throw error;
  }
}
