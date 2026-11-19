import { createHash } from "node:crypto";
import { join } from "node:path";
import { MAX_SOCKET_PATH_BYTES, runtimeDir, userTmpDir } from "../daemon/paths.js";
import { storePaths } from "../store/paths.js";
import type { AbsolutePath } from "../types/common.js";

/*
 * Spec 021 D22 (row 021-36): where the store process of one clone's store
 * file lives. One process per clone and file; the first slice serves
 * `code.sqlite` alone, so `StoreFile` has one member.
 */

/** The store files a store process serves. */
export type StoreFile = "code";

/** The first 16 hex characters of sha256 over the common dir, as a worktree id is over its root. */
export function cloneIdOf(commonDir: AbsolutePath): string {
  return createHash("sha256").update(commonDir).digest("hex").slice(0, 16);
}

/**
 * `locks/store-<file>.sqlite`: the store process holds it for its life (D22.2,
 * the daemon's own lock, spec 001 D10), so two daemons that start one at once
 * start one; the loser exits. Never a worktree's lock name (`lockFileWorktreeId`).
 */
export function storeProcessLockPath(commonDir: AbsolutePath, file: StoreFile): AbsolutePath {
  return join(storePaths(commonDir).locksDir, `store-${file}.sqlite`);
}

const LOCK_NAME = /^store-(code)\.sqlite$/;

/** The store file whose store process holds a `storeProcessLockPath` file named `name`; `null` for any other name. */
export function storeProcessLockFile(name: string): StoreFile | null {
  return (LOCK_NAME.exec(name)?.[1] as StoreFile | undefined) ?? null;
}

/** `logs/store-<file>.log`: the store process's stdout and stderr. */
export function storeProcessLogPath(commonDir: AbsolutePath, file: StoreFile): AbsolutePath {
  return join(storePaths(commonDir).dir, "logs", `store-${file}.log`);
}

/**
 * `<runtime dir>/squeal-<file>-<clone id>.sock`, with the daemon socket's
 * fallback to `/tmp/squeal-<uid>` for a long runtime dir. The name never
 * matches a daemon's (`socketWorktreeId`).
 */
export function storeProcessSocketPath(
  commonDir: AbsolutePath,
  file: StoreFile,
  env: NodeJS.ProcessEnv = process.env,
): AbsolutePath {
  const name = `squeal-${file}-${cloneIdOf(commonDir)}.sock`;
  const path = join(runtimeDir(env), name);
  return Buffer.byteLength(path) <= MAX_SOCKET_PATH_BYTES ? path : join(userTmpDir(), name);
}
