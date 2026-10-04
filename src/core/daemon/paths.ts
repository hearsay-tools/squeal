import { lstatSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { isMissing } from "../fs/index.js";
import type { AbsolutePath, WorktreeId } from "../types/index.js";

/**
 * Directory of daemon sockets: `XDG_RUNTIME_DIR` when it is set to an
 * absolute path, else the OS temp dir. Spec 001 D1: sockets live "never under
 * the worktree, because socket paths are limited to 104 bytes on macOS".
 */
export function runtimeDir(env: NodeJS.ProcessEnv = process.env): AbsolutePath {
  const xdg = env.XDG_RUNTIME_DIR;
  return xdg !== undefined && xdg !== "" && isAbsolute(xdg) ? xdg : tmpdir();
}

/** macOS `sun_path` holds 104 bytes including the terminating NUL (research, daemon lifecycle). */
export const MAX_SOCKET_PATH_BYTES = 103;

/**
 * Spec 001 D1: "`<runtime dir>/squeal-<worktree-hash>.sock`". When a long
 * runtime dir would push the path past `MAX_SOCKET_PATH_BYTES`, binding
 * fails with `EINVAL`, so the socket goes to `/tmp` instead. Daemon and
 * hooks derive the same path from the same environment.
 */
export function socketPathFor(
  worktreeId: WorktreeId,
  env: NodeJS.ProcessEnv = process.env,
): AbsolutePath {
  const name = `squeal-${worktreeId}.sock`;
  const path = join(runtimeDir(env), name);
  return Buffer.byteLength(path) <= MAX_SOCKET_PATH_BYTES ? path : join("/tmp", name);
}

/**
 * The `<common-dir>/worktrees/<name>` entry of a linked worktree: the
 * `gitdir:` of its `.git` file. `null` for a main worktree, whose `.git` is a
 * directory. Spec 001 D10: the daemon exits "when
 * `<common-dir>/worktrees/<name>` disappears".
 */
export function linkedWorktreeDir(root: AbsolutePath): AbsolutePath | null {
  const dotGit = join(root, ".git");
  try {
    if (!lstatSync(dotGit).isFile()) return null;
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
  const match = /^gitdir:\s*(.+?)\s*$/m.exec(readFileSync(dotGit, "utf8"));
  return match?.[1] ? resolve(root, match[1]) : null;
}
