import { compare } from "../fs/compare.js";
import type { ImportMap } from "../store/import-graph.js";
import type { RelativePath } from "../types/common.js";
import { isModulePath } from "./names.js";

/*
 * Spec 015 D11: one shortest value-import chain from a test file, or from a
 * project's setup roots, to each file it reaches, over the walk written
 * with the test file's current key (review 0.1.415-r2, R2). Static and
 * dynamic targets both load a module (Squeal's closure holds both), so
 * both are edges here. A module the walk holds no entry for stops it there:
 * a gap when the module has bytes, a leaf when it has none (a file a test
 * writes at run time; 015-116, P2).
 */

/** The walk from one or more starts: each reached file's parent on a shortest chain. */
export interface Walk {
  /** The chain from a start to `path`, both ends included; `null` when the walk did not reach it. */
  chain(path: RelativePath): readonly RelativePath[] | null;
  /** Some module the walk reached has bytes and no entry in the stored walk. */
  readonly incomplete: boolean;
}

/** Per stored walk, each file's targets as `targetsIn` gives them. */
const known = new WeakMap<ImportMap, Map<RelativePath, readonly RelativePath[] | undefined>>();

/**
 * The file's direct targets in `imports`, static then dynamic, each sorted;
 * `undefined` when the walk holds no entry for it. Each map is read once
 * per file.
 */
export function targetsIn(
  imports: ImportMap,
  path: RelativePath,
): readonly RelativePath[] | undefined {
  let byPath = known.get(imports);
  if (byPath === undefined) {
    byPath = new Map();
    known.set(imports, byPath);
  }
  if (byPath.has(path)) return byPath.get(path);
  const entry = imports.get(path);
  const sorted =
    entry === undefined
      ? undefined
      : [...new Set([...[...entry.static].sort(compare), ...[...entry.dynamic].sort(compare)])];
  byPath.set(path, sorted);
  return sorted;
}

/**
 * A breadth-first walk of `imports` from `starts`, so the first parent
 * found is on a shortest chain. `hasBytes` tells a module the walk did not
 * record from one that does not exist.
 */
export function walk(
  imports: ImportMap,
  starts: readonly RelativePath[],
  hasBytes: (path: RelativePath) => boolean,
): Walk {
  const parent = new Map<RelativePath, RelativePath | null>();
  let incomplete = false;
  let frontier = [...starts];
  for (const start of starts) parent.set(start, null);
  while (frontier.length > 0) {
    const next: RelativePath[] = [];
    for (const from of frontier) {
      const targets = targetsIn(imports, from);
      if (targets === undefined) {
        // A non-module file (JSON, a snapshot) or an absent one is a leaf; a module with bytes was not recorded.
        if (isModulePath(from) && hasBytes(from)) incomplete = true;
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
 * The setup chains of one environment: a walk of its config and setup
 * walks from the roots the runner recorded (review 0.1.415 B3), the files
 * it loads first. No root is inferred from the flat file list; a file no
 * recorded edge reaches has no chain.
 */
export function setupWalk(
  environment: { readonly roots: readonly RelativePath[]; readonly imports: ImportMap },
  hasBytes: (path: RelativePath) => boolean,
): Walk {
  return walk(environment.imports, [...environment.roots].sort(compare), hasBytes);
}
