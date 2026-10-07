import { basename, join, relative } from "node:path";
import type { AbsolutePath, InvalidatedPath, RelativePath } from "../../../core/types/index.js";
import type { LoaderChain } from "./loader-chain.js";
import { ModuleTable } from "./modules.js";
import type { Resolver } from "./resolver.js";

/** The static closure of one test file, or of the project's preloads (spec 003 D3). */
export interface StaticClosure {
  /**
   * The modules reached, every `package.json` and `tsconfig.json` their
   * resolutions read, the absent candidates of unresolved specifiers, and
   * the files template-literal `import()` globs match. Worktree-relative,
   * sorted, `node_modules` excluded.
   */
  readonly paths: readonly RelativePath[];
  /** False when `incomplete` has a reason: a computed `import(p)`, an unparsable module. */
  readonly complete: boolean;
  readonly incomplete: readonly string[];
}

export interface TestFileClosure extends StaticClosure {
  readonly testFile: RelativePath;
}

/** {@link import("../../../core/types/index.js").AffectedTestFiles} in worktree-relative paths. */
export interface AffectedPaths {
  readonly direct: readonly RelativePath[];
  readonly transitive: readonly RelativePath[];
}

interface Computed {
  readonly modules: ReadonlySet<AbsolutePath>;
  readonly paths: ReadonlySet<AbsolutePath>;
  readonly incomplete: readonly string[];
}

const MANIFEST = /^(?:package\.json|tsconfig.*\.json)$/;

/**
 * Closures, the reverse index and `affected` over a {@link ModuleTable}
 * (spec 003 D3, D4). Closures are recomputed lazily: an edit marks the test
 * files whose closure holds the edited module, and the next query rebuilds
 * those and their reverse-index entries.
 */
export class Graph {
  private readonly table: ModuleTable;
  private testFiles: AbsolutePath[] = [];
  private closures = new Map<AbsolutePath, Computed>();
  private dirty = new Set<AbsolutePath>();
  /** Path to the test files whose closure holds it. */
  private holders = new Map<AbsolutePath, Set<AbsolutePath>>();
  private preloadClosure: Computed | null = null;
  private readonly preloadRoots: AbsolutePath[] = [];
  private preloadIncomplete: string[] = [];
  private preloadCandidates: AbsolutePath[] = [];
  /** Paths a run loaded outside the static closure, per test file (D3, D5). */
  private readonly observed = new Map<AbsolutePath, ReadonlySet<AbsolutePath>>();

  constructor(
    private readonly root: AbsolutePath,
    private readonly cwd: AbsolutePath,
    private readonly chain: LoaderChain,
    private readonly resolver: Resolver,
  ) {
    this.table = new ModuleTable(root, resolver, chain.rules === "tsx");
  }

  /** Cold build, or a full re-resolve after `reset`: every closure from scratch. */
  build(testFiles: readonly RelativePath[]): void {
    this.testFiles = testFiles.map((f) => this.abs(f));
    this.resolvePreloads();
    this.table.reach([...this.preloadRoots, ...this.testFiles]);
    this.closures = new Map();
    this.holders = new Map();
    this.preloadClosure = null;
    this.dirty = new Set(this.testFiles);
  }

  setTestFiles(testFiles: readonly RelativePath[]): void {
    const next = testFiles.map((f) => this.abs(f));
    const keep = new Set(next);
    for (const file of this.testFiles) if (!keep.has(file)) this.drop(file);
    this.table.reach(next);
    for (const file of next) if (!this.closures.has(file)) this.dirty.add(file);
    this.testFiles = next;
  }

  invalidate(paths: readonly InvalidatedPath[]): void {
    const structural = paths.some(
      (p) =>
        p.kind !== "change" || MANIFEST.test(basename(p.path)) || this.isRead(this.abs(p.path)),
    );
    if (structural) {
      this.resolver.clear();
      this.table.reset(paths.filter((p) => p.kind !== "add").map((p) => this.abs(p.path)));
      this.build(this.testFiles.map((f) => this.rel(f)));
      return;
    }
    for (const { path } of paths) {
      const file = this.abs(path);
      if (!this.table.reparse(file)) continue;
      for (const holder of this.holders.get(file) ?? []) this.dirty.add(holder);
      if (this.preloadClosure?.modules.has(file)) this.preloadClosure = null;
    }
  }

  closure(testFile: RelativePath): TestFileClosure {
    const computed = this.computed(this.abs(testFile));
    return { testFile, ...this.present(computed) };
  }

  preloads(): StaticClosure {
    return this.present(this.preloadComputed());
  }

  /**
   * D4: `direct` is every changed test file and every test file that imports
   * a changed path in one hop (or read it, or probed it as a candidate);
   * `transitive` the other test files whose closure holds a changed path or
   * whose last run loaded it; every test file when a preload's closure holds one.
   */
  affected(changed: readonly RelativePath[]): AffectedPaths {
    this.refresh();
    const direct = new Set<AbsolutePath>();
    const transitive = new Set<AbsolutePath>();
    const preload = this.preloadComputed();
    const tests = new Set(this.testFiles);
    for (const path of changed.map((p) => this.abs(p))) {
      if (tests.has(path)) direct.add(path);
      if (preload.paths.has(path)) for (const file of this.testFiles) transitive.add(file);
      for (const file of this.holders.get(path) ?? []) {
        const node = this.table.node(file);
        const oneHop =
          node !== undefined &&
          (node.deps.has(path) || node.reads.has(path) || node.candidates.has(path));
        (oneHop ? direct : transitive).add(file);
      }
      for (const [file, paths] of this.observed) if (paths.has(path)) transitive.add(file);
    }
    for (const file of direct) transitive.delete(file);
    return { direct: this.sorted(direct), transitive: this.sorted(transitive) };
  }

  recordObserved(testFile: RelativePath, paths: readonly RelativePath[]): void {
    this.observed.set(this.abs(testFile), new Set(paths.map((p) => this.abs(p))));
  }

  /** The `.js`/`.ts` pairs every current closure meets under tsx. */
  pairs(): readonly (readonly [RelativePath, RelativePath])[] {
    this.refresh();
    const seen = new Map<string, readonly [RelativePath, RelativePath]>();
    const modules = [...this.closures.values(), this.preloadComputed()].flatMap((c) => [
      ...c.modules,
    ]);
    for (const module of modules) {
      for (const [js, ts] of this.table.node(module)?.pairs ?? []) {
        seen.set(js, [this.rel(js), this.rel(ts)]);
      }
    }
    return [...seen.values()].sort((a, b) => a[0].localeCompare(b[0]));
  }

  private computed(file: AbsolutePath): Computed {
    if (!this.testFiles.includes(file)) {
      throw new Error(`node-test graph: ${this.rel(file)} is not a test file of this project`);
    }
    this.refresh();
    const computed = this.closures.get(file);
    if (computed === undefined) throw new Error(`node-test graph: no closure for ${file}`);
    return computed;
  }

  private refresh(): void {
    if (this.dirty.size === 0) return;
    for (const file of this.dirty) {
      this.drop(file);
      const computed = this.walk([file], []);
      this.closures.set(file, computed);
      for (const path of computed.paths) {
        const set = this.holders.get(path);
        if (set === undefined) this.holders.set(path, new Set([file]));
        else set.add(file);
      }
    }
    this.dirty.clear();
  }

  private drop(file: AbsolutePath): void {
    for (const path of this.closures.get(file)?.paths ?? []) this.holders.get(path)?.delete(file);
    this.closures.delete(file);
  }

  private walk(roots: readonly AbsolutePath[], extra: readonly AbsolutePath[]): Computed {
    const modules = new Set<AbsolutePath>(roots);
    const paths = new Set<AbsolutePath>([...roots, ...extra]);
    const incomplete = new Set<string>();
    const stack = [...roots];
    for (let file = stack.pop(); file !== undefined; file = stack.pop()) {
      const node = this.table.node(file);
      if (node === undefined) continue;
      for (const read of node.reads) paths.add(read);
      for (const candidate of node.candidates) paths.add(candidate);
      for (const reason of node.incomplete) incomplete.add(reason);
      for (const dep of node.deps) {
        if (modules.has(dep)) continue;
        modules.add(dep);
        paths.add(dep);
        stack.push(dep);
      }
    }
    return { modules, paths, incomplete: [...incomplete].sort() };
  }

  private resolvePreloads(): void {
    this.preloadRoots.length = 0;
    this.preloadIncomplete = [];
    this.preloadCandidates = [];
    const from = join(this.cwd, "[argv]");
    for (const { specifier, kind } of this.chain.preloads) {
      const resolution = this.resolver.resolve(specifier, from, kind);
      if (resolution.path === null) {
        this.preloadIncomplete.push(`preload ${JSON.stringify(specifier)} does not resolve`);
        this.preloadCandidates.push(...resolution.candidates);
      } else {
        this.preloadRoots.push(resolution.path);
      }
      this.preloadCandidates.push(...resolution.reads);
    }
  }

  private preloadComputed(): Computed {
    if (this.preloadClosure === null) {
      const walked = this.walk(this.preloadRoots, this.preloadCandidates);
      this.preloadClosure = {
        ...walked,
        incomplete: [...this.preloadIncomplete, ...walked.incomplete],
      };
    }
    return this.preloadClosure;
  }

  private present(computed: Computed): StaticClosure {
    return {
      paths: this.sorted(computed.paths),
      complete: computed.incomplete.length === 0,
      incomplete: computed.incomplete,
    };
  }

  private isRead(path: AbsolutePath): boolean {
    for (const computed of [...this.closures.values(), this.preloadClosure]) {
      if (computed?.paths.has(path) && !computed.modules.has(path)) return true;
    }
    return false;
  }

  private sorted(paths: Iterable<AbsolutePath>): RelativePath[] {
    return [...paths].map((p) => this.rel(p)).sort();
  }

  private abs(path: RelativePath): AbsolutePath {
    return join(this.root, path);
  }

  private rel(path: AbsolutePath): RelativePath {
    return relative(this.root, path);
  }
}
