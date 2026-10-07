import { chmodSync, lstatSync, mkdirSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import type { AbsolutePath, WorktreeId } from "../types/index.js";

/**
 * Directory of daemon sockets: `XDG_RUNTIME_DIR` when it is set to an
 * absolute path, else `userTmpDir()`. Spec 001 D1: sockets live "never
 * under the worktree, because socket paths are limited to 104 bytes on
 * macOS". Review S8: a fixed name in a shared, sticky temp dir lets another
 * local user bind it first, so the fallback is a directory of this user's
 * own (`prepareSocketDir`). Never the inherited `TMPDIR`: another tool may
 * reap it, and a hook started with another one would look elsewhere.
 */
export function runtimeDir(env: NodeJS.ProcessEnv = process.env): AbsolutePath {
  return xdgRuntimeDir(env) ?? userTmpDir();
}

/** macOS `sun_path` holds 104 bytes including the terminating NUL (research, daemon lifecycle). */
export const MAX_SOCKET_PATH_BYTES = 103;

/**
 * Spec 001 D1: "`<runtime dir>/squeal-<worktree-hash>.sock`". When a long
 * runtime dir would push the path past `MAX_SOCKET_PATH_BYTES`, binding
 * fails with `EINVAL`, so the socket goes to `/tmp/squeal-<uid>` instead.
 * Daemon and hooks derive the same path from `XDG_RUNTIME_DIR` alone.
 */
export function socketPathFor(
  worktreeId: WorktreeId,
  env: NodeJS.ProcessEnv = process.env,
): AbsolutePath {
  const name = `squeal-${worktreeId}.sock`;
  const path = join(runtimeDir(env), name);
  return Buffer.byteLength(path) <= MAX_SOCKET_PATH_BYTES ? path : join(userTmpDir(), name);
}

/**
 * Makes the directory of `socketPath` ready for the daemon to bind in, or
 * throws saying why it must not. Review S8: outside `XDG_RUNTIME_DIR` the
 * directory is created with mode 0700, and an existing one must be a real
 * directory owned by `uid` that no one else can enter; anything else may
 * belong to another user, who could then answer for this daemon. An
 * `XDG_RUNTIME_DIR` is private to its user by the XDG specification and is
 * used as it is.
 */
export function prepareSocketDir(
  socketPath: AbsolutePath,
  env: NodeJS.ProcessEnv = process.env,
  uid: number = currentUid(),
): void {
  const dir = dirname(socketPath);
  if (dir === xdgRuntimeDir(env)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    return;
  }
  preparePrivateDir(dir, uid);
}

/**
 * Creates `dir` with mode 0700 when it is missing, then checks it as
 * `checkPrivateDir` does. For a directory of this user's own in a shared,
 * sticky temp dir (review S8), where another user could have made it first.
 */
export function preparePrivateDir(
  dir: AbsolutePath,
  uid: number = currentUid(),
  role = "socket directory",
): void {
  mkdirSync(dirname(dir), { recursive: true });
  try {
    mkdirSync(dir, { mode: 0o700 });
    // The umask may have taken bits off; the mode must be exactly 0700.
    chmodSync(dir, 0o700);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  checkPrivateDir(dir, uid, role);
}

/** Throws unless `dir` is a directory, not a symlink, owned by `uid`, with no group or other permissions. */
export function checkPrivateDir(dir: AbsolutePath, uid: number, role = "socket directory"): void {
  const stat = lstatSync(dir);
  if (!stat.isDirectory()) {
    throw new Error(`${role} ${dir} is not a directory; refusing to use it`);
  }
  if (stat.uid !== uid) {
    throw new Error(`${role} ${dir} is owned by uid ${stat.uid}, not ${uid}; refusing to use it`);
  }
  if ((stat.mode & 0o077) !== 0) {
    const mode = (stat.mode & 0o777).toString(8).padStart(3, "0");
    throw new Error(`${role} ${dir} has mode ${mode}, not 700; refusing to use it`);
  }
}

/**
 * `/tmp/squeal-<uid>`: this user's directory in the system temp dir, never
 * the inherited `TMPDIR` and never inside a repository. The socket fallbacks
 * (`runtimeDir`, `socketPathFor`) and the daemon's temp directories
 * (`daemonScratch`) live here.
 */
export function userTmpDir(uid: number = currentUid()): AbsolutePath {
  return join("/tmp", `squeal-${uid}`);
}

export { linkedWorktreeDir } from "../fs/index.js";

function xdgRuntimeDir(env: NodeJS.ProcessEnv): AbsolutePath | null {
  const xdg = env.XDG_RUNTIME_DIR;
  return xdg !== undefined && xdg !== "" && isAbsolute(xdg) ? xdg : null;
}

/** The real uid; `process.getuid` is missing only on Windows, where no other user shares the temp dir. */
export function currentUid(): number {
  return process.getuid?.() ?? 0;
}
