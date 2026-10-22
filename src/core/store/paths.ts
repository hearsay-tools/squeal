import { basename, dirname, join } from "node:path";
import type { AbsolutePath, WorktreeId } from "../types/index.js";

/** Spec 001 D1: the store layout under `<git-common-dir>/squeal/`. */
export interface StorePaths {
  readonly dir: AbsolutePath;
  readonly database: AbsolutePath;
  readonly runsDir: AbsolutePath;
  readonly locksDir: AbsolutePath;
}

export function storePaths(commonDir: AbsolutePath): StorePaths {
  const dir = join(commonDir, "squeal");
  return {
    dir,
    database: join(dir, "store.sqlite"),
    runsDir: join(dir, "runs"),
    locksDir: join(dir, "locks"),
  };
}

/** Spec 001 D1: "`locks/<worktree-hash>.sqlite`: one exclusive-lock database per worktree". */
export function lockFileFor(commonDir: AbsolutePath, worktreeId: WorktreeId): AbsolutePath {
  return join(storePaths(commonDir).locksDir, `${worktreeId}.sqlite`);
}

const LOCK_NAME = /^([0-9a-f]{16})\.sqlite$/;

/** The worktree id a `lockFileFor` file name holds; `null` for any other name, a waiter's lock among them. */
export function lockFileWorktreeId(name: string): WorktreeId | null {
  return LOCK_NAME.exec(name)?.[1] ?? null;
}

/** The common dir and worktree id of a `lockFileFor` path; `null` for any other path. */
export function lockFileParts(
  path: AbsolutePath,
): { readonly commonDir: AbsolutePath; readonly worktreeId: WorktreeId } | null {
  const worktreeId = lockFileWorktreeId(basename(path));
  if (worktreeId === null) return null;
  const commonDir = dirname(dirname(dirname(path)));
  return lockFileFor(commonDir, worktreeId) === path ? { commonDir, worktreeId } : null;
}
