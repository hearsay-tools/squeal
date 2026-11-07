import type {
  CoverageView,
  DeclaredPattern,
  ReachSnapshot,
  ReachTestFile,
} from "../../src/core/reach/types.js";
import type { ImportGraph } from "../../src/core/store/import-graph.js";

/* Fixtures for `squeal reach` (row 015-109): a fake import graph and snapshots built from plain maps. */

/**
 * Static targets by importer; `dynamic` holds dynamic ones; a file absent
 * from both is not recorded. `environment` gives each project's files and
 * the roots its setup chains start at.
 */
export function fakeGraph(
  edges: Record<string, string[]>,
  environment: Record<string, { files: string[]; roots: string[] }> = {},
  dynamic: Record<string, string[]> = {},
): ImportGraph {
  return {
    targets: (path) =>
      path in edges || path in dynamic
        ? { static: edges[path] ?? [], dynamic: dynamic[path] ?? [] }
        : undefined,
    environment: (project) => environment[project],
  };
}

export const UNKNOWN: CoverageView = { kind: "unknown" };
export const NONE: CoverageView = { kind: "none" };

/** A record: `called` ran a function, `loaded` loaded only, `unread` unconfirmed. */
export function record(
  called: string[],
  loaded: string[] = [],
  unread: string[] = [],
): CoverageView {
  return {
    kind: "record",
    called: new Set(called),
    loaded: new Set([...called, ...loaded]),
    unread: new Set(unread),
  };
}

export function testFile(
  path: string,
  closure: string[],
  overrides: Partial<Omit<ReachTestFile, "ref">> & { project?: string } = {},
): ReachTestFile {
  const { project = "", ...rest } = overrides;
  return {
    ref: { project, path },
    runner: "vitest",
    inSuite: true,
    seconds: 1,
    closure,
    childProcess: new Set(),
    runtimeRead: new Set(),
    coverage: UNKNOWN,
    ...rest,
  };
}

export interface SnapshotOptions {
  readonly graph?: ImportGraph | null;
  readonly barrels?: string[];
  /** Per barrel, the targets it re-exports with `export *`. */
  readonly stars?: Record<string, string[]>;
  readonly functions?: Record<string, number>;
  readonly declared?: Record<string, DeclaredPattern>;
  readonly edits?: { at: number; paths: string[] }[];
  readonly coverageOn?: boolean;
  readonly complexityEnabled?: boolean;
}

export function snapshot(
  testFiles: ReachTestFile[],
  {
    graph = null,
    barrels = [],
    stars = {},
    functions = {},
    declared = {},
    edits = [],
    coverageOn = true,
    complexityEnabled = true,
  }: SnapshotOptions = {},
): ReachSnapshot {
  return {
    testFiles,
    edits,
    coverage: { on: coverageOn, coverageEnabled: coverageOn, complexityEnabled },
    graph,
    modules: {
      barrel: (path) => barrels.includes(path),
      starTargets: (path) => new Set(stars[path] ?? []),
      functions: (path) => functions[path] ?? null,
    },
    declared: (_test, path) => declared[path] ?? null,
  };
}
