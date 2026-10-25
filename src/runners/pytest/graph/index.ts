import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import type { AbsolutePath, InvalidatedPath, RelativePath } from "../../../core/types/index.js";
import { type AffectedPaths, Graph, type StaticClosure, type TestFileClosure } from "./graph.js";
import { pythonParserReady } from "./parse.js";
import type { ImportMode, SearchPath } from "./search-path.js";

export type { DerivedRoots } from "./derive-roots.js";
export type { AffectedPaths, StaticClosure, TestFileClosure } from "./graph.js";
export {
  type ParsedPython,
  type PythonImport,
  parsePython,
  pythonParserReady,
  withPythonTree,
} from "./parse.js";
export type { ImportMode, Location, SearchPath } from "./search-path.js";

export interface PytestGraphOptions {
  /** The worktree root; closures hold paths inside it only. */
  readonly root: AbsolutePath;
  /** The project's `cwd`, from which pytest runs. */
  readonly cwd: AbsolutePath;
  /**
   * The environment directory D2 discovered, or `null`. Without one, or
   * before its `pyvenv.cfg` exists, roots are derived from `pyproject.toml`.
   */
  readonly env: AbsolutePath | null;
  /** The project's test files, relative to `root`. */
  readonly testFiles: readonly RelativePath[];
  /** pytest's rootdir, where the conftest chain starts; default `cwd`. */
  readonly rootdir?: AbsolutePath;
  /** From `--import-mode` in `args` or `addopts`; default `prepend`. */
  readonly importMode?: ImportMode;
  /** The pytest config's `pythonpath`, absolute, in order. */
  readonly pythonpath?: readonly AbsolutePath[];
  /** The pytest config file: a change to it re-resolves every closure. */
  readonly configFile?: AbsolutePath | null;
}

/**
 * The static module graph of one pytest project (spec 007 D4, D5), built
 * from files alone with tree-sitter-python: with the environment's
 * `sys.path` model, or without an environment from roots derived from
 * `pyproject.toml`, with equal closures either way. Every path in and out
 * is relative to the worktree root.
 */
export interface PytestGraph {
  /** D4's closure of one listed test file; throws for a file not listed. */
  closure(testFile: RelativePath): TestFileClosure;
  /**
   * D2: the closure of plugin modules (`pytest11` entry points, `-p`) by
   * dotted name, inside the worktree, for the environment hash.
   */
  pluginClosure(modules: readonly string[]): StaticClosure;
  /** D5: test files affected by changed paths, split direct and transitive. */
  affected(changed: readonly RelativePath[]): AffectedPaths;
  /**
   * D5: a content change re-parses that file; an add or a delete of a `.py`
   * file, or a change to `pyvenv.cfg`, a `.pth` file, `pyproject.toml`,
   * `setup.cfg`, `.python-version` or the pytest config, re-derives the
   * search path and re-resolves every closure from cached parses.
   */
  invalidate(paths: readonly InvalidatedPath[]): void;
  /** Replaces the listed test files after `testFiles()` was refreshed. */
  setTestFiles(testFiles: readonly RelativePath[]): void;
  /** Each listed test file whose closure is incomplete, with the reasons. */
  incompleteClosures(): readonly (readonly [RelativePath, readonly string[]])[];
  /** The current search path, and whether it came from the environment or was derived. */
  searchPath(): SearchPath;
  /** Layouts the derivation did not read, when the search path is derived. */
  notes(): readonly string[];
}

export async function createPytestGraph(options: PytestGraphOptions): Promise<PytestGraph> {
  await pythonParserReady();
  const root = realpathSync(options.root);
  const cwd = realpathSync(options.cwd);
  // Every prefix compares with the real root; a path that does not exist yet stays as given.
  const real = (path: AbsolutePath) => {
    const absolute = resolve(cwd, path);
    try {
      return realpathSync(absolute);
    } catch {
      return absolute;
    }
  };
  const graph = new Graph({
    root,
    cwd,
    env: options.env === null ? null : real(options.env),
    rootdir: options.rootdir === undefined ? cwd : real(options.rootdir),
    importMode: options.importMode ?? "prepend",
    pythonpath: (options.pythonpath ?? []).map(real),
    configFile: options.configFile == null ? null : real(options.configFile),
  });
  graph.build(options.testFiles);
  return {
    closure: (testFile) => graph.closure(testFile),
    pluginClosure: (modules) => graph.pluginClosure(modules),
    affected: (changed) => graph.affected(changed),
    invalidate: (paths) => graph.invalidate(paths),
    setTestFiles: (testFiles) => graph.setTestFiles(testFiles),
    incompleteClosures: () => graph.incompleteClosures(),
    searchPath: () => graph.searchPath(),
    notes: () => graph.searchPath().notes.map((note) => `pytest: ${note}`),
  };
}
