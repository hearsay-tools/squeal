import type { EnvironmentWalk, TestWalk } from "../store/import-graph.js";
import type { RelativePath } from "../types/common.js";
import { setupWalk, type Walk, walk } from "./chains.js";
import { isHelperPath, isModulePath } from "./names.js";
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
  /** An `import` or `setup` pair the stored edges do not reach: its chain is not recorded. */
  readonly notRecorded?: true;
  readonly declared?: DeclaredPattern;
}

/** What the pairs of every test file share: the test paths and each environment's setup walk. */
export class PairContext {
  readonly #setups = new WeakMap<
    EnvironmentWalk,
    { files: ReadonlySet<RelativePath>; walk: Walk }
  >();
  readonly tests: ReadonlySet<RelativePath>;

  constructor(readonly snapshot: ReachSnapshot) {
    this.tests = new Set(snapshot.testFiles.map((t) => t.ref.path));
  }

  /** The environment files of `walk`'s key and their setup walk; `null` without a stored one. */
  setup(walked: TestWalk | undefined) {
    const environment = walked?.environment;
    if (environment === undefined) return null;
    let setup = this.#setups.get(environment);
    if (setup === undefined) {
      const walked = setupWalk(environment, (path) => this.snapshot.modules.hasBytes(path));
      setup = { files: new Set(environment.files), walk: walked };
      this.#setups.set(environment, setup);
    }
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
  // Review 0.1.415-r2 (R2): every chain of the file comes from the walk written with its current key.
  const walked = context.snapshot.graph?.walk(test.ref);
  const setup = context.setup(walked);
  const paths = new Set<RelativePath>(test.closure ?? []);
  for (const file of setup?.files ?? []) paths.add(file);
  let imports: Walk | undefined;
  const importWalk = (found: TestWalk) => {
    imports ??= walk(found.imports, [test.ref.path], (path) =>
      context.snapshot.modules.hasBytes(path),
    );
    return imports;
  };
  const pairs: Pair[] = [];
  for (const path of paths) {
    if (!context.isSource(test, path)) continue;
    if (setup?.files.has(path) === true) {
      // Review 0.1.415 B3: a file no recorded edge from a root reaches has no chain, never one of its own.
      const chain = setup.walk.chain(path);
      const known = pair(test, path, "setup", chain ?? [], chain?.at(-2) ?? null);
      // 015-116 (P2): only a module with bytes is a gap; an absent file or a manifest is a leaf.
      const modules = context.snapshot.modules;
      const gap = chain === null && isModulePath(path) && modules.hasBytes(path);
      pairs.push(gap ? { ...known, notRecorded: true } : known);
    } else {
      pairs.push(closurePair(test, path, context, walked, importWalk));
    }
  }
  return pairs;
}

/** D11's path of a closure path that is no setup file: declared, observed, else an import. */
function closurePair(
  test: ReachTestFile,
  path: RelativePath,
  context: PairContext,
  walked: TestWalk | undefined,
  importWalk: (found: TestWalk) => Walk,
): Pair {
  const declared = context.snapshot.declared(test.ref.path, path);
  if (declared !== null) return { ...pair(test, path, "declared input", [], null), declared };
  if (test.childProcess.has(path)) return pair(test, path, "child process", [], null);
  if (test.runtimeRead.has(path)) return pair(test, path, "runtime read", [], null);
  if (walked !== undefined) return importPair(test, path, importWalk(walked), context);
  if (!isModulePath(path)) return pair(test, path, "runtime read", [], null);
  const unsplit = pair(test, path, "import", [], null);
  // A graph but no walk written with this key: the chain is not recorded yet. Only Vitest
  // records walks; node:test and pytest pairs read import, unsplit (D11; 015-116, P2).
  const walks = context.snapshot.graph !== null && test.runner === "vitest";
  return walks ? { ...unsplit, notRecorded: true } : unsplit;
}

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
    if (!isModulePath(path)) return pair(test, path, "runtime read", [], null);
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
