import { compare } from "../fs/compare.js";
import type { ImportGraph } from "../store/import-graph.js";
import type { RelativePath } from "../types/common.js";

/*
 * Spec 015 D11: one shortest value-import chain from a test file, or from a
 * project's setup files, to each file it reaches, over row 015-108's
 * stored edges. Static and dynamic targets both load a module (Squeal's
 * closure holds both), so both are edges here. A file whose edges are not
 * recorded at its current bytes stops the walk there: a chain is never
 * built from edges of bytes the worktree no longer has.
 */

/** The walk from one or more starts: each reached file's parent on a shortest chain. */
export interface Walk {
  /** The chain from a start to `path`, both ends included; `null` when the walk did not reach it. */
  chain(path: RelativePath): readonly RelativePath[] | null;
  /** Some file the walk reached has no edges recorded at its current bytes. */
  readonly incomplete: boolean;
}

/** Per graph, each project's file's targets as `targetsOf` gives them: every test file's walk asks again. */
const known = new WeakMap<ImportGraph, Map<string, readonly RelativePath[] | undefined>>();

/**
 * The file's direct targets as `project` resolves them, static then
 * dynamic, each sorted; `undefined` when not recorded. The graph is asked
 * once per project and file.
 */
export function targetsOf(
  graph: ImportGraph,
  project: string,
  path: RelativePath,
): readonly RelativePath[] | undefined {
  let byPath = known.get(graph);
  if (byPath === undefined) {
    byPath = new Map();
    known.set(graph, byPath);
  }
  const key = `${project}\0${path}`;
  if (byPath.has(key)) return byPath.get(key);
  const targets = graph.targets(path, project);
  const sorted =
    targets === undefined
      ? undefined
      : [...new Set([...[...targets.static].sort(compare), ...[...targets.dynamic].sort(compare)])];
  byPath.set(key, sorted);
  return sorted;
}

/** A breadth-first walk of `project`'s edges from `starts`, so the first parent found is on a shortest chain. */
export function walk(graph: ImportGraph, project: string, starts: readonly RelativePath[]): Walk {
  const parent = new Map<RelativePath, RelativePath | null>();
  let incomplete = false;
  let frontier = [...starts];
  for (const start of starts) parent.set(start, null);
  while (frontier.length > 0) {
    const next: RelativePath[] = [];
    for (const from of frontier) {
      const targets = targetsOf(graph, project, from);
      if (targets === undefined) {
        incomplete = true;
        continue;
      }
      for (const to of targets) {
        if (parent.has(to)) continue;
        parent.set(to, from);
        next.push(to);
      }
    }
    frontier = next;
  }
  return {
    incomplete,
    chain(path) {
      if (!parent.has(path)) return null;
      const chain: RelativePath[] = [];
      for (let at: RelativePath | null | undefined = path; at != null; at = parent.get(at)) {
        chain.push(at);
      }
      return chain.reverse();
    },
  };
}

/**
 * The setup chains of one project: a walk of its edges from the roots the
 * runner recorded (review 0.1.415 B3), the files it loads first: config
 * files, `setupFiles` and `globalSetup` entries. No root is inferred from
 * the flat file list; a file no recorded edge reaches has no chain.
 */
export function setupWalk(
  graph: ImportGraph,
  project: string,
  roots: readonly RelativePath[],
): Walk {
  return walk(graph, project, [...roots].sort(compare));
}
