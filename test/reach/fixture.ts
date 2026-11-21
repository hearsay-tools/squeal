import type {
  CoverageView,
  DeclaredPattern,
  ReachSnapshot,
  ReachTestFile,
} from "../../src/core/reach/types.js";
import type { ImportGraph, ImportMap } from "../../src/core/store/import-graph.js";

/* Fixtures for `squeal reach` (row 015-109): a fake import graph and snapshots built from plain maps. */

/**
 * Every test file's keyed walk holds `edges` (static targets by importer)
 * and `dynamic`; a file absent from both is not recorded. `environment`
 * gives each project's files and setup roots, whose walk is the same map.
 */
export function fakeGraph(
  edges: Record<string, string[]>,
  environment: Record<string, { files: string[]; roots: string[] }> = {},
  dynamic: Record<string, string[]> = {},
): ImportGraph {
  const imports: ImportMap = new Map(
    [...new Set([...Object.keys(edges), ...Object.keys(dynamic)])].map((path) => [
      path,
      { static: edges[path] ?? [], dynamic: dynamic[path] ?? [] },
    ]),
  );
  const environments = new Map(
    Object.entries(environment).map(([project, env]) => [project, { ...env, imports }]),
  );
  return { walk: (ref) => ({ imports, environment: environments.get(ref.project) }) };
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
    current: true,
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
  /** Modules that export no runtime value; any other reads `null`, not known. */
  readonly typesOnly?: string[];
  /** Modules that export a runtime value. */
  readonly values?: string[];
  /** Files that do not exist in the worktree. */
  readonly missing?: string[];
  readonly onStart?: ReachSnapshot["onStart"];
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
    typesOnly = [],
    values = [],
    missing = [],
    onStart = "lookup-only",
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
      exportsValue: (path) =>
        typesOnly.includes(path) ? false : values.includes(path) ? true : null,
      hasBytes: (path) => !missing.includes(path),
    },
    declared: (_test, path) => declared[path] ?? null,
    onStart,
  };
}
