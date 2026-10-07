import { realpathSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { compare } from "../../../core/fs/index.js";
import type { WorktreePaths } from "../../../core/fs/worktree-paths.js";
import type { AbsolutePath, RelativePath, TestFileRef } from "../../../core/types/index.js";

/**
 * The project files one test file's process loaded, from the recorder's
 * edges (spec 003 D5). Worktree-relative, sorted, `node_modules` and paths
 * outside the worktree left out. A test that spawns `node` itself is not
 * observed past the spawn (open question 3).
 */
export interface ObservedClosure {
  readonly testFile: TestFileRef;
  /** Reachable from the test file, the test file included. */
  readonly paths: readonly RelativePath[];
  /** Reachable from the preloads (`--import`, `--require`), which go to the environment hash (D3). */
  readonly preloadPaths: readonly RelativePath[];
}

interface Edge {
  readonly parent: string | null;
  readonly url: string;
}

/**
 * Reachability from the test file's URL over the edges of its process
 * (`graphs`: the recorder's NDJSON files). Every other import whose parent
 * is no loaded module, such as an `--import` resolved from the cwd, is a
 * preload root. `null` when the recorder saw nothing of the test file:
 * a Node without `module.registerHooks`, or a process that never loaded it.
 */
export function observedClosure(
  testFile: TestFileRef,
  absolute: AbsolutePath,
  graphs: readonly string[],
  paths: WorktreePaths,
): ObservedClosure | null {
  const edges = graphs.flatMap(parseEdges);
  const entry = pathToFileURL(real(absolute)).href;
  const children = new Map<string, string[]>();
  for (const { parent, url } of edges) {
    if (parent === null) continue;
    children.set(parent, [...(children.get(parent) ?? []), url]);
  }
  if (!edges.some((e) => e.url === entry || e.parent === entry)) return null;
  // `--import` specifiers resolve from the cwd's directory URL, the entry point from no parent
  const loaded = new Set(edges.map((e) => e.url));
  const roots = edges
    .filter((e) => (e.parent === null || !loaded.has(e.parent)) && e.url !== entry)
    .map((e) => e.url);
  return {
    testFile,
    paths: projectPaths(reach([entry], children), paths),
    preloadPaths: projectPaths(reach(roots, children), paths),
  };
}

function parseEdges(text: string): Edge[] {
  const edges: Edge[] = [];
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    try {
      const { parent, url } = JSON.parse(line) as { parent?: unknown; url?: unknown };
      if (typeof url !== "string") continue;
      edges.push({ parent: typeof parent === "string" ? parent : null, url });
    } catch {
      // a partial last line of a killed process
    }
  }
  return edges;
}

function reach(roots: readonly string[], children: ReadonlyMap<string, readonly string[]>) {
  const seen = new Set(roots);
  const stack = [...roots];
  for (let url = stack.pop(); url !== undefined; url = stack.pop()) {
    for (const child of children.get(url) ?? []) {
      if (seen.has(child)) continue;
      seen.add(child);
      stack.push(child);
    }
  }
  return seen;
}

function projectPaths(urls: Iterable<string>, paths: WorktreePaths): RelativePath[] {
  const out = new Set<RelativePath>();
  for (const url of urls) {
    if (!url.startsWith("file:")) continue;
    // a loader may add a query, as tsx does for some namespaces
    const file = fileURLToPath(url.replace(/[?#].*$/, ""));
    if (!paths.isProjectFile(file)) continue;
    const relative = paths.toRelative(file);
    if (relative !== null) out.add(relative);
  }
  return [...out].sort(compare);
}

/** Node resolves the entry point to its real path; the recorder's URLs are real paths. */
function real(path: AbsolutePath): AbsolutePath {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}
