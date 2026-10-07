import { realpathSync } from "node:fs";
import type { AbsolutePath, InvalidatedPath, RelativePath } from "../../../core/types/index.js";
import { type AffectedPaths, Graph, type StaticClosure, type TestFileClosure } from "./graph.js";
import { readLoaderChain } from "./loader-chain.js";
import { parserReady } from "./parse.js";
import { createResolver } from "./resolver.js";

export type { AffectedPaths, StaticClosure, TestFileClosure } from "./graph.js";

export interface NodeTestGraphOptions {
  /** The worktree root; closures hold paths inside it only. */
  readonly root: AbsolutePath;
  /** The project's `cwd`, from which its preloads resolve. */
  readonly cwd: AbsolutePath;
  /** The project's flags before `--test` (spec 003 D1): loader chain, preloads, conditions. */
  readonly argv: readonly string[];
  /** The project's test files, relative to `root`. */
  readonly testFiles: readonly RelativePath[];
}

/**
 * The static module graph of one node:test project (spec 003 D3, D4), built
 * from files alone: es-module-lexer plus enhanced-resolve configured from the
 * loader chain. Every path in and out is relative to the worktree root.
 */
export interface NodeTestGraph {
  /** D3's closure of one listed test file; throws for a file not listed. */
  closure(testFile: RelativePath): TestFileClosure;
  /** The closure of every `--import` and `--require` preload, for the environment hash. */
  preloads(): StaticClosure;
  /** D4: test files affected by changed paths, split direct and transitive. */
  affected(changed: readonly RelativePath[]): AffectedPaths;
  /**
   * D4: a content change re-parses that file; an add, a delete, or a change
   * to a `package.json`, a `tsconfig.json` or another file a resolution read
   * clears the resolver and re-resolves every closure from cached parses.
   */
  invalidate(paths: readonly InvalidatedPath[]): void;
  /** Replaces the listed test files after `testFiles()` was refreshed. */
  setTestFiles(testFiles: readonly RelativePath[]): void;
  /**
   * Paths a run of `testFile` loaded outside its static closure (D3, D5).
   * They never enter `closure()`; a change to one makes the file affected.
   */
  recordObserved(testFile: RelativePath, paths: readonly RelativePath[]): void;
  /**
   * Paths the preloads loaded at run time outside their static closure
   * (review wave 2, B1), replacing the last set. A change to one makes every
   * test file affected, as a preload's own closure does.
   */
  recordObservedPreloads(paths: readonly RelativePath[]): void;
  /**
   * Each listed test file whose static closure is incomplete, with the
   * reasons (D3: a computed `import()` or `require()`, an unparsable module).
   */
  incompleteClosures(): readonly (readonly [RelativePath, readonly string[]])[];
  /**
   * Problem notes: an unrecognized loader (a `--loader`, or a bare preload
   * outside the worktree's modules), a preload that may register hooks, a
   * `.js`/`.ts` pair under tsx.
   */
  notes(): readonly string[];
}

export async function createNodeTestGraph(options: NodeTestGraphOptions): Promise<NodeTestGraph> {
  await parserReady;
  const root = realpathSync(options.root);
  const cwd = realpathSync(options.cwd);
  const chain = readLoaderChain(options.argv);
  const graph = new Graph(root, cwd, chain, createResolver(chain, root));
  graph.build(options.testFiles);
  const loaderNotes = () => [
    ...chain.unrecognized.map(
      (loader) =>
        `node-test: unrecognized loader ${JSON.stringify(loader)} in argv; resolving with ${chain.rules === "tsx" ? "tsx's" : "Node's own"} rules`,
    ),
    ...graph.preloadNotes(),
  ];
  return {
    closure: (testFile) => graph.closure(testFile),
    preloads: () => graph.preloads(),
    affected: (changed) => graph.affected(changed),
    invalidate: (paths) => graph.invalidate(paths),
    setTestFiles: (testFiles) => graph.setTestFiles(testFiles),
    recordObserved: (testFile, paths) => graph.recordObserved(testFile, paths),
    recordObservedPreloads: (paths) => graph.recordObservedPreloads(paths),
    incompleteClosures: () => graph.incompleteClosures(),
    notes: () => [
      ...loaderNotes(),
      ...graph
        .pairs()
        .map(
          ([js, ts]) =>
            `node-test: ${JSON.stringify(js)} and ${JSON.stringify(ts)} both exist; tsx loads either one depending on the importer, Squeal assumes ${JSON.stringify(ts)} (unsupported layout)`,
        ),
    ],
  };
}
