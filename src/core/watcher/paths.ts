import type { RelativePath } from "../types/index.js";

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

export { hasGitEntry } from "../fs/index.js";
