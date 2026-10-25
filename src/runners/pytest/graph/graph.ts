import { existsSync } from "node:fs";
import { basename, dirname, join, relative, sep } from "node:path";
import type { AbsolutePath, InvalidatedPath, RelativePath } from "../../../core/types/index.js";
import { ClosureIndex, type RawClosure, walk } from "./closures.js";
import { ModuleTable } from "./modules.js";
import { Resolver } from "./resolver.js";
import { type ImportMode, type SearchPath, searchPath } from "./search-path.js";

/** A static closure (spec 007 D4). */
export interface StaticClosure {
  /**
   * The file, its parent packages' `__init__.py`, its conftest chain, the
   * `pytest_plugins` modules, their transitive static closure inside the
   * worktree and every import's absent candidates. Worktree-relative,
   * sorted, the environment excluded.
   */
  readonly paths: readonly RelativePath[];
  /** False when `incomplete` has a reason: a computed import, a computed `pytest_plugins`, a parse error. */
  readonly complete: boolean;
  readonly incomplete: readonly string[];
}

/** The static closure of one test file. */
export interface TestFileClosure extends StaticClosure {
  readonly testFile: RelativePath;
}

/** `AffectedTestFiles` of `src/core/types/runner.ts`, in worktree-relative paths. */
export interface AffectedPaths {
  readonly direct: readonly RelativePath[];
  readonly transitive: readonly RelativePath[];
}

export interface GraphSettings {
  readonly root: AbsolutePath;
  readonly cwd: AbsolutePath;
  readonly env: AbsolutePath | null;
  readonly rootdir: AbsolutePath;
  readonly importMode: ImportMode;
  readonly pythonpath: readonly AbsolutePath[];
  readonly configFile: AbsolutePath | null;
}

/** Files whose content decides resolution (D5): a change re-resolves every closure. */
const STRUCTURAL = /^(?:pyvenv\.cfg|pyproject\.toml|setup\.cfg|\.python-version|.*\.pth)$/;

/**
 * Closures, the reverse index and `affected` of one pytest project (spec
 * 007 D4, D5) over a {@link ModuleTable}. The {@link ClosureIndex} is
 * rebuilt whole, lazily, when a module's edges changed.
 */
export class Graph {
  private readonly table: ModuleTable;
  private readonly resolver: Resolver;
  private readonly prefix: string;
  private testFiles: AbsolutePath[] = [];
  /** Each test file's conftest chain, from the rootdir down. */
  private chains = new Map<AbsolutePath, readonly AbsolutePath[]>();
  private path: SearchPath;
  private index: ClosureIndex | null = null;

  constructor(private readonly settings: GraphSettings) {
    this.prefix = settings.root + sep;
    this.path = { locations: [], mapped: [], source: "derived", notes: [] };
    this.resolver = new Resolver(settings.root, settings.env, this.path);
    this.table = new ModuleTable(this.resolver, (path) => this.rel(path));
  }

  /** Cold build, or a full re-resolve from cached parses. */
  build(testFiles: readonly RelativePath[], dropped: readonly AbsolutePath[] = []): void {
    this.testFiles = testFiles.map((f) => this.abs(f));
    this.chains = new Map(this.testFiles.map((file) => [file, this.conftests(file)]));
    const pytestModules = new Set<AbsolutePath>(this.testFiles);
    for (const chain of this.chains.values()) for (const file of chain) pytestModules.add(file);
    this.path = searchPath({
      root: this.settings.root,
      cwd: this.settings.cwd,
      env: this.settings.env,
      importMode: this.settings.importMode,
      pythonpath: this.settings.pythonpath,
      pytestModules: [...pytestModules].sort(),
    });
    this.resolver.reset(this.path);
    this.table.reset(dropped);
    this.table.reach([...pytestModules]);
    this.index = null;
  }

  invalidate(paths: readonly InvalidatedPath[]): void {
    const structural = paths.some(
      ({ path, kind }) =>
        ((kind === "add" || kind === "delete") && /\.py$/.test(path)) ||
        STRUCTURAL.test(basename(path)) ||
        this.abs(path) === this.settings.configFile,
    );
    if (structural) {
      const dropped = paths.filter((p) => p.kind !== "add").map((p) => this.abs(p.path));
      this.build(
        this.testFiles.map((f) => this.rel(f)),
        dropped,
      );
      return;
    }
    for (const { path } of paths) if (this.table.reparse(this.abs(path))) this.index = null;
  }

  setTestFiles(testFiles: readonly RelativePath[]): void {
    this.build(testFiles);
  }

  closure(testFile: RelativePath): TestFileClosure {
    const closure = this.current().closures.get(this.abs(testFile));
    if (closure === undefined) {
      throw new Error(`pytest graph: ${testFile} is not a test file of this project`);
    }
    return { testFile, ...this.present(closure) };
  }

  /**
   * D2: the closure of plugin modules (`pytest11` entry points, `-p`) inside
   * the worktree, loaded as pytest loads a plugin, for the environment hash.
   */
  pluginClosure(modules: readonly string[]): StaticClosure {
    const roots: AbsolutePath[] = [];
    const candidates: AbsolutePath[] = [];
    for (const module of modules) {
      const resolution = this.resolver.resolve(module);
      roots.push(...resolution.files);
      candidates.push(...resolution.candidates);
    }
    this.table.reach(roots);
    const closure = walk((path) => this.table.node(path), roots);
    return this.present({ ...closure, members: new Set([...closure.members, ...candidates]) });
  }

  /**
   * D5: `direct` is every changed test file, every test file that imports a
   * changed path in one hop (or probed it as a candidate, or names it in
   * `pytest_plugins`), and for a changed `conftest.py` every test file in
   * its directory and below; `transitive` the other test files whose closure
   * holds a changed path. What runs imported beyond the graph, and the
   * `direct` marks of what a process a test started imported (task 007-55),
   * the core keeps (spec 016 D4).
   */
  affected(changed: readonly RelativePath[]): AffectedPaths {
    const index = this.current();
    const direct = new Set<AbsolutePath>();
    const transitive = new Set<AbsolutePath>();
    for (const path of changed.map((p) => this.abs(p))) {
      if (index.closures.has(path)) direct.add(path);
      if (basename(path) === "conftest.py") {
        const under = dirname(path) + sep;
        for (const file of this.testFiles) if (file.startsWith(under)) direct.add(file);
      }
      for (const file of index.holdersOf(path)) {
        const node = this.table.node(file);
        const oneHop =
          node !== undefined &&
          (node.deps.has(path) || node.candidates.has(path) || node.plugins.has(path));
        (oneHop ? direct : transitive).add(file);
      }
    }
    for (const file of direct) transitive.delete(file);
    return { direct: this.sorted(direct), transitive: this.sorted(transitive) };
  }

  /** Each test file whose static closure is incomplete, with its reasons, in listing order. */
  incompleteClosures(): readonly (readonly [RelativePath, readonly string[]])[] {
    const index = this.current();
    return this.testFiles.flatMap((file) => {
      const reasons = index.closures.get(file)?.incomplete ?? [];
      return reasons.length === 0 ? [] : [[this.rel(file), reasons] as const];
    });
  }

  searchPath(): SearchPath {
    return this.path;
  }

  private current(): ClosureIndex {
    this.index ??= new ClosureIndex((path) => this.table.node(path), this.chains);
    return this.index;
  }

  /** Every `conftest.py` from the rootdir down to the file's directory (module-graph Q2). */
  private conftests(file: AbsolutePath): AbsolutePath[] {
    const dirs: AbsolutePath[] = [];
    const top = this.settings.rootdir;
    let at = dirname(file);
    for (;;) {
      dirs.unshift(at);
      if (at === top || !at.startsWith(top + sep)) break;
      at = dirname(at);
    }
    return dirs.map((d) => join(d, "conftest.py")).filter((c) => c !== file && existsSync(c));
  }

  private present(closure: RawClosure): StaticClosure {
    const paths = [...closure.members].map((p) => this.rel(p)).sort();
    return { paths, complete: closure.incomplete.length === 0, incomplete: closure.incomplete };
  }

  private sorted(paths: Iterable<AbsolutePath>): RelativePath[] {
    return [...paths].map((p) => this.rel(p)).sort();
  }

  private abs(path: RelativePath): AbsolutePath {
    return join(this.settings.root, path);
  }

  private rel(path: AbsolutePath): RelativePath {
    return path.startsWith(this.prefix)
      ? path.slice(this.prefix.length)
      : relative(this.settings.root, path);
  }
}
