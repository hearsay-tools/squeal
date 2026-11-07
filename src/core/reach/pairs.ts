import type { RelativePath } from "../types/common.js";
import { setupWalk, type Walk, walk } from "./chains.js";
import { isHelperPath } from "./names.js";
import type { CoverageView, DeclaredPattern, ReachSnapshot, ReachTestFile } from "./types.js";

/*
 * Spec 015 D11: each (source, test file) pair gets one path, the
 * strongest, and one coverage state. `import` is split by one shortest
 * chain when row 015-108's edges are there, and unsplit without them.
 */

export type PathKind =
  | "setup"
  | "declared input"
  | "child process"
  | "runtime read"
  | "direct"
  | "barrel"
  | "test helper"
  | "transitive"
  | "import";

export const PATH_KINDS: readonly PathKind[] = [
  "setup",
  "declared input",
  "child process",
  "runtime read",
  "direct",
  "barrel",
  "test helper",
  "transitive",
  "import",
];

/** The kinds the test file's own imports give: the only ones whose seconds can be avoidable. */
export const IMPORT_KINDS: ReadonlySet<PathKind> = new Set([
  "direct",
  "barrel",
  "test helper",
  "transitive",
  "import",
]);

export type CoverageState =
  | "called"
  | "loaded only"
  | "not loaded"
  | "unread"
  | "no record"
  | "outside the test's process"
  | "unknown";

export const COVERAGE_STATES: readonly CoverageState[] = [
  "called",
  "loaded only",
  "not loaded",
  "unread",
  "no record",
  "outside the test's process",
  "unknown",
];

/** One source file a test file re-runs on. */
export interface Pair {
  readonly path: RelativePath;
  readonly kind: PathKind;
  readonly coverage: CoverageState;
  /** From the test file, or the setup file, to the source; empty when no chain is known. */
  readonly chain: readonly RelativePath[];
  /** The last barrel or helper on the chain, else the module that imports the file directly. */
  readonly gateway: RelativePath | null;
  /** An `import` pair the stored edges do not reach yet: `path not recorded yet`. */
  readonly notRecorded?: true;
  readonly declared?: DeclaredPattern;
}

/** What the pairs of every test file share: the test paths and each project's setup walk. */
export class PairContext {
  readonly #setups = new Map<string, { files: ReadonlySet<RelativePath>; walk: Walk } | null>();
  readonly tests: ReadonlySet<RelativePath>;

  constructor(readonly snapshot: ReachSnapshot) {
    this.tests = new Set(snapshot.testFiles.map((t) => t.ref.path));
  }

  /** The project's environment files and their walk; `null` without stored ones. */
  setup(project: string) {
    if (this.#setups.has(project)) return this.#setups.get(project) ?? null;
    const graph = this.snapshot.graph;
    const files = graph?.environment(project);
    const setup =
      graph == null || files === undefined
        ? null
        : { files: new Set(files), walk: setupWalk(graph, files) };
    this.#setups.set(project, setup);
    return setup;
  }

  /** A listed test file is never a source; a closure's listing paths (`dir/`) are not files. */
  isSource(test: ReachTestFile, path: RelativePath): boolean {
    return path !== test.ref.path && !path.endsWith("/") && !this.tests.has(path);
  }

  isHelper(path: RelativePath): boolean {
    return !this.tests.has(path) && isHelperPath(path);
  }
}

/** The pairs of `test`: its closure and its project's environment files. */
export function pairsOf(test: ReachTestFile, context: PairContext): Pair[] {
  const setup = context.setup(test.ref.project);
  const paths = new Set<RelativePath>(test.closure ?? []);
  for (const file of setup?.files ?? []) paths.add(file);
  const graph = context.snapshot.graph;
  let imports: Walk | undefined;
  const pairs: Pair[] = [];
  for (const path of paths) {
    if (!context.isSource(test, path)) continue;
    if (setup?.files.has(path) === true) {
      const chain = setup.walk.chain(path) ?? [path];
      pairs.push(pair(test, path, "setup", chain, chain.at(-2) ?? null));
      continue;
    }
    const declared = context.snapshot.declared(test.ref.path, path);
    if (declared !== null) {
      pairs.push({ ...pair(test, path, "declared input", [], null), declared });
    } else if (test.childProcess.has(path)) {
      pairs.push(pair(test, path, "child process", [], null));
    } else if (test.runtimeRead.has(path)) {
      pairs.push(pair(test, path, "runtime read", [], null));
    } else if (graph === null) {
      pairs.push(pair(test, path, MODULE.test(path) ? "import" : "runtime read", [], null));
    } else {
      imports ??= walk(graph, [test.ref.path]);
      pairs.push(importPair(test, path, imports, context));
    }
  }
  return pairs;
}

/**
 * A module a test file can import. Any other closure path no import edge
 * reaches (a snapshot, a fixture the runner keys) is read at run time,
 * so it never reads as an avoidable import.
 */
const MODULE = /\.(?:[mc]?[jt]s|[jt]sx|py)$/;

function pair(
  test: ReachTestFile,
  path: RelativePath,
  kind: PathKind,
  chain: readonly RelativePath[],
  gateway: RelativePath | null,
): Pair {
  return { path, kind, coverage: coverageOf(test.coverage, path, kind), chain, gateway };
}

/** D11 4: direct, barrel or test helper by the last such module on the chain, else transitive. */
function importPair(test: ReachTestFile, path: RelativePath, imports: Walk, context: PairContext) {
  const chain = imports.chain(path);
  if (chain === null) {
    if (!MODULE.test(path)) return pair(test, path, "runtime read", [], null);
    const unsplit = pair(test, path, "import", [], null);
    return imports.incomplete ? { ...unsplit, notRecorded: true as const } : unsplit;
  }
  const between = chain.slice(1, -1);
  for (let at = between.length - 1; at >= 0; at--) {
    const module = between[at] as RelativePath;
    if (context.snapshot.modules.barrel(module)) return pair(test, path, "barrel", chain, module);
    if (context.isHelper(module)) return pair(test, path, "test helper", chain, module);
  }
  const importer = chain.at(-2) ?? test.ref.path;
  return pair(test, path, between.length === 0 ? "direct" : "transitive", chain, importer);
}

const OUTSIDE: ReadonlySet<PathKind> = new Set([
  "setup",
  "declared input",
  "child process",
  "runtime read",
]);

/** D11 "Coverage per pair", from the test file's record at its current key. */
export function coverageOf(view: CoverageView, path: RelativePath, kind: PathKind): CoverageState {
  if (view.kind === "unknown") return "unknown";
  if (view.kind === "none") return "no record";
  if (view.called.has(path)) return "called";
  if (view.loaded.has(path)) return "loaded only";
  if (view.unread.has(path)) return "unread";
  return OUTSIDE.has(kind) ? "outside the test's process" : "not loaded";
}
