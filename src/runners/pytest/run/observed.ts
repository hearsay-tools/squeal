import { dirname, sep } from "node:path";
import { compare } from "../../../core/fs/index.js";
import type { WorktreePaths } from "../../../core/fs/worktree-paths.js";
import type { RelativePath, TestFileRef } from "../../../core/types/index.js";
import type { ImportEvent } from "./events.js";
import type { BatchFile } from "./report.js";

/** The project files one test file's run imported (spec 007 D6), worktree-relative and sorted. */
export interface PytestObservedClosure {
  readonly testFile: TestFileRef;
  /** Reachable from the test file and the conftests above it, the test file included. */
  readonly paths: readonly RelativePath[];
}

export interface BatchObserved {
  readonly closures: readonly PytestObservedClosure[];
  /**
   * Reachable from what the batch imported outside every collector, item
   * and conftest: start-up plugins (`pytest11`, `-p`), which D2 puts in the
   * environment hash, and the modules pytest imports for `pytest_plugins`.
   * For the adapter (007-14); nothing here keys a test file.
   */
  readonly session: readonly RelativePath[];
}

/**
 * Reachability over one batch's import edges (spec 007 D6, module-graph
 * Q3): an edge leaves its importer when that is a project file, else the
 * file whose collector or item was in progress, else the session. A test
 * file's roots are itself and every loaded `conftest.py` in its directory or
 * above, whose `pytest_plugins` the plugin wrote as edges of their own; the
 * plugin writes an imported module's parent packages as edges too, so
 * `__init__.py` files pytest runs on import are reached.
 */
export function observeBatch(
  edges: readonly ImportEvent[],
  files: readonly BatchFile[],
  paths: WorktreePaths,
): BatchObserved {
  const children = new Map<string, Set<string>>();
  const session = new Set<string>();
  const conftests = new Set<string>();
  for (const edge of edges) {
    if (edge.to.endsWith(`${sep}conftest.py`)) conftests.add(edge.to);
    const from = edge.from ?? edge.ctx;
    if (from === null) session.add(edge.to);
    else {
      const set = children.get(from) ?? new Set();
      set.add(edge.to);
      children.set(from, set);
    }
  }
  const reach = (roots: Iterable<string>): RelativePath[] => {
    const seen = new Set<string>();
    const todo = [...roots];
    for (let next = todo.pop(); next !== undefined; next = todo.pop()) {
      if (seen.has(next)) continue;
      seen.add(next);
      todo.push(...(children.get(next) ?? []));
    }
    return [...seen]
      .flatMap((p) => {
        const relative = paths.toRelative(p);
        return relative === null ? [] : [relative];
      })
      .sort(compare);
  };
  const closures = files.map(({ testFile, real }) => {
    const dir = dirname(real);
    const own = [...conftests].filter(
      (c) => dir === dirname(c) || dir.startsWith(`${dirname(c)}${sep}`),
    );
    return { testFile, paths: reach([real, ...own]) };
  });
  // A module loaded past the wrapper (an entry point's `import_module`, bound
  // before the plugin loaded) shows only as an importer.
  const imported = new Set(edges.map((e) => e.to));
  const tests = new Set(files.map((f) => f.real as string));
  for (const { from } of edges) {
    if (from !== null && !imported.has(from) && !tests.has(from)) session.add(from);
  }
  return { closures, session: reach([...session].filter((p) => !conftests.has(p))) };
}
