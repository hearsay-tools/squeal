import { isAbsolute, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { AbsolutePath, RelativePath } from "../../types/common.js";

/*
 * Spec 017 D4: the modules the worker resolved, as the project files and
 * the package roots the config loaded. `root` is the project root's real
 * path, since Node resolves a module to its real path.
 */

const NODE_MODULES = `${sep}node_modules${sep}`;

export interface LoadedSets {
  readonly closure: readonly RelativePath[];
  /**
   * Each package's folder, `<…>/node_modules/<name>` or `<…>/node_modules/@scope/name`.
   * A file outside the project and outside every `node_modules` stands as its own path.
   */
  readonly packages: readonly string[];
}

export function sortLoaded(urls: Iterable<string>, root: AbsolutePath): LoadedSets {
  const closure = new Set<RelativePath>();
  const packages = new Set<string>();
  for (const url of urls) {
    if (!url.startsWith("file:")) continue;
    const path = fileURLToPath(url.split("?")[0] ?? url);
    const pkg = packageRoot(path);
    const inside = projectPath(path, root);
    if (pkg !== null) packages.add(pkg);
    else if (inside !== null) closure.add(inside);
    else packages.add(path);
  }
  return { closure: [...closure].sort(), packages: [...packages].sort() };
}

/** A path inside the project and outside `node_modules`, relative with `/`; `null` otherwise. */
export function projectPath(path: AbsolutePath, root: AbsolutePath): RelativePath | null {
  const rel = relative(root, path);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) return null;
  if (`${sep}${rel}${sep}`.includes(NODE_MODULES)) return null;
  return rel.split(sep).join("/");
}

/**
 * A path as keys hold it (wave 1.7 Q2): relative to the project root with
 * `/`, and `../` above it, so worktrees of one layout share keys; `null`
 * under `node_modules`, whose bytes the install fingerprint holds. `roots`
 * are the root's real path and the path it was given by.
 */
export function keyPath(
  path: AbsolutePath,
  roots: readonly [AbsolutePath, ...AbsolutePath[]],
): RelativePath | null {
  if (path.includes(NODE_MODULES)) return null;
  const inside = roots.map((root) => relative(root, path)).find((rel) => !rel.startsWith(".."));
  const rel = inside ?? relative(roots[0], path);
  if (rel === "" || isAbsolute(rel)) return null;
  return rel.split(sep).join("/");
}

function packageRoot(path: AbsolutePath): string | null {
  const at = path.lastIndexOf(NODE_MODULES);
  if (at < 0) return null;
  const start = at + NODE_MODULES.length;
  const parts = path.slice(start).split(sep);
  const name = parts[0]?.startsWith("@") ? parts.slice(0, 2) : parts.slice(0, 1);
  return path.slice(0, start) + name.join(sep);
}
