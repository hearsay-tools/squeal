import { lstat } from "node:fs/promises";
import { join } from "node:path";
import { isMissing } from "../fs/index.js";
import type { AbsolutePath, RelativePath } from "../types/index.js";

/** `path` and each of its ancestors, deepest first, root excluded: `a/b/c`, `a/b`, `a`. */
export function* selfAndAncestors(path: RelativePath): Generator<RelativePath> {
  let current = path;
  while (true) {
    yield current;
    const slash = current.lastIndexOf("/");
    if (slash < 0) return;
    current = current.slice(0, slash);
  }
}

/** True when any segment of the path is `.git`: a repository's metadata, never an input. */
export function isGitMetadata(path: RelativePath): boolean {
  return (
    path === ".git" || path.startsWith(".git/") || path.includes("/.git/") || path.endsWith("/.git")
  );
}

/** True when `<dir>/.git` exists. A file (linked worktree, submodule) counts as much as a directory. */
export async function hasGitEntry(dir: AbsolutePath): Promise<boolean> {
  try {
    await lstat(join(dir, ".git"));
    return true;
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
}
