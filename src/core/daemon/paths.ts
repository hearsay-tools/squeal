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

/** Spec 001 D1: "`<runtime dir>/squeal-<worktree-hash>.sock`". */
export function socketPathFor(
  worktreeId: WorktreeId,
  env: NodeJS.ProcessEnv = process.env,
): AbsolutePath {
  return join(runtimeDir(env), `squeal-${worktreeId}.sock`);
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
