import { realpathSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { compare } from "../../../core/fs/index.js";
import type { WorktreePaths } from "../../../core/fs/worktree-paths.js";
import type { AbsolutePath, RelativePath, TestFileRef } from "../../../core/types/index.js";

/**
 * The project files one test file's run loaded, from the recorder's edges
 * (spec 003 D5): its own process, the `node --test` child, and for a slow
 * project the processes the test spawns (004 D5). Worktree-relative, sorted,
 * `node_modules` and paths outside the worktree left out.
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
  /** The specifier as the importer wrote it. */
  readonly specifier: string | null;
  /** Resolved before the test file's own entry point, so a project preload made it (the recorder's phase). */
  readonly preload: boolean;
}

/**
 * Reachability over the edges of one file's run (`graphs`: the recorder's
 * NDJSON files, one per process). An import whose parent is no loaded
 * module (an `--import` resolves from the cwd's directory URL, a `--require`
 * and an entry point from none) roots the preloads when its specifier is one
 * of `preloads`, the `--import` and `--require` values of the project's argv
 * and `NODE_OPTIONS`, or when the recorder saw it before the test file's entry
 * point in the test file's own main thread: a preload's
 * `createRequire(<package.json>)` load (004 review S1). Every other such root
 * is the test file's, since one run runs one test file (lessons.md defect 3):
 * the test's own `createRequire(<package.json>)` load, a spawned process's
 * entry point, or what a worker or a spawned process loads before its entry
 * (004 re-review S2, S3). `null` when the recorder saw nothing of the test file: a Node
 * without `module.registerHooks`, or a process that never loaded it.
 */
export function observedClosure(
  testFile: TestFileRef,
  absolute: AbsolutePath,
  graphs: readonly string[],
  preloads: ReadonlySet<string>,
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
  const loaded = new Set(edges.map((e) => e.url));
  const fileRoots = [entry];
  const preloadRoots: string[] = [];
  for (const { parent, url, specifier, preload } of edges) {
    if (url === entry || (parent !== null && loaded.has(parent))) continue;
    const ofPreload = preload || (specifier !== null && preloads.has(specifier));
    (ofPreload ? preloadRoots : fileRoots).push(url);
  }
  return {
    testFile,
    paths: projectPaths(reach(fileRoots, children), paths),
    preloadPaths: projectPaths(reach(preloadRoots, children), paths),
  };
}

function parseEdges(text: string): Edge[] {
  const edges: Edge[] = [];
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    try {
      const { parent, url, specifier, preload } = JSON.parse(line) as Record<string, unknown>;
      if (typeof url !== "string") continue;
      edges.push({
        parent: typeof parent === "string" ? parent : null,
        url,
        specifier: typeof specifier === "string" ? specifier : null,
        preload: preload === true,
      });
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
