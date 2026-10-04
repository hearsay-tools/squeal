import { lstat } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";
import type { AbsolutePath, RelativePath } from "../types/index.js";

/** `abs` relative to `root` with `/` separators, or `null` when it is the root or outside it. */
export function toRelative(root: AbsolutePath, abs: AbsolutePath): RelativePath | null {
  const rel = relative(root, abs);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) return null;
  return sep === "/" ? rel : rel.split(sep).join("/");
}

export function toAbsolute(root: AbsolutePath, rel: RelativePath): AbsolutePath {
  return join(root, ...rel.split("/"));
}

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

/** True for the errors `lstat` gives when a path, or one of its parents, does not exist. */
export function isMissing(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return code === "ENOENT" || code === "ENOTDIR";
}
