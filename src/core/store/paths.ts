import { join } from "node:path";
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
