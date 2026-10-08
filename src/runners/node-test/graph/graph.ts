import { basename, join, relative, sep } from "node:path";
import type {
  AbsolutePath,
  InvalidatedPath,
  PackageImport,
  RelativePath,
  RunnerPackages,
} from "../../../core/types/index.js";
import { ClosureIndex } from "./closures.js";
import type { LoaderChain } from "./loader-chain.js";
import { ModuleTable } from "./modules.js";
import { PackageSet, packageImport, UNNAMED } from "./packages.js";
import { preloadNotes } from "./preload-notes.js";
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

/** `AffectedTestFiles` of `src/core/types/runner.ts`, in worktree-relative paths. */
export interface AffectedPaths {
  readonly direct: readonly RelativePath[];
  readonly transitive: readonly RelativePath[];
}

const MANIFEST = /^(?:package\.json|tsconfig.*\.json)$/;

/**
 * Closures, the reverse index and `affected` over a {@link ModuleTable}
 * (spec 003 D3, D4). The {@link ClosureIndex} is rebuilt whole, lazily, when
 * a module's edges changed; an edit that keeps every edge costs one parse.
 */
export class Graph {
  private readonly table: ModuleTable;
  private readonly prefix: string;
  private testFiles: AbsolutePath[] = [];
  private index: ClosureIndex | null = null;
  private readonly preloadRoots: AbsolutePath[] = [];
  private preloadIncomplete: string[] = [];
  /** Reads and candidates of resolving the preloads themselves from `cwd`. */
  private preloadExtra: AbsolutePath[] = [];
  /** Bare preloads outside the worktree's own modules: loaders Squeal does not model. */
  private outsidePreloads: string[] = [];
  /** Paths a run loaded outside the static closure, per test file (D3, D5). */
  private readonly observed = new Map<AbsolutePath, ReadonlySet<AbsolutePath>>();
  /** Paths the preloads loaded at run time outside their static closure (review wave 2, B1). */
  private observedPreloads: ReadonlySet<AbsolutePath> = new Set();

  constructor(
    private readonly root: AbsolutePath,
    private readonly cwd: AbsolutePath,
    private readonly chain: LoaderChain,
    private readonly resolver: Resolver,
  ) {
    this.table = new ModuleTable(root, resolver, chain.rules === "tsx");
    this.prefix = root + sep;
  }

  /** Cold build, or a full re-resolve after a reset. */
  build(testFiles: readonly RelativePath[]): void {
    try {
      this.testFiles = testFiles.map((f) => this.abs(f));
      this.resolvePreloads();
      this.table.reach([...this.preloadRoots, ...this.testFiles]);
      this.index = null;
    } finally {
      this.resolver.release();
    }
  }

  setTestFiles(testFiles: readonly RelativePath[]): void {
    try {
      this.testFiles = testFiles.map((f) => this.abs(f));
      this.table.reach(this.testFiles);
      this.index = null;
    } finally {
      this.resolver.release();
    }
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
    try {
      for (const { path } of paths) if (this.table.reparse(this.abs(path))) this.index = null;
    } finally {
      this.resolver.release();
    }
  }

  closure(testFile: RelativePath): TestFileClosure {
    const index = this.current();
    const bits = index.test(this.abs(testFile));
    if (bits === undefined) {
      throw new Error(`node-test graph: ${testFile} is not a test file of this project`);
    }
    return { testFile, ...this.present(index, bits, []) };
  }

  preloads(): StaticClosure {
    const index = this.current();
    return this.present(index, index.preload, this.preloadIncomplete);
  }

  /** Task 003-22: what the project modules of a test file's static closure import in one hop. */
  packages(testFile: RelativePath): RunnerPackages {
    const index = this.current();
    const bits = index.test(this.abs(testFile));
    if (bits === undefined) {
      throw new Error(`node-test graph: ${testFile} is not a test file of this project`);
    }
    return this.collect(index, bits).packages();
  }

  /**
   * Task 003-22: what the preloads' closure imports in one hop, and the
   * loader chain's packages, looked up from `cwd`, as the runner's: tsx, a
   * bare `--loader`, a bare preload under `node_modules`. A loader given as
   * a path is in no closure, so what it imports is unknown: `module`.
   */
  environmentPackages(): RunnerPackages {
    const index = this.current();
    const set = this.collect(index, index.preload);
    const cwd = this.rel(this.cwd);
    const from = cwd.startsWith("..") ? null : cwd;
    const tsx = this.chain.rules === "tsx" ? ["tsx"] : [];
    const runner: PackageImport[] = [];
    for (const specifier of [...this.outsidePreloads, ...this.chain.unrecognized, ...tsx]) {
      const entry = from === null ? null : packageImport(from, specifier);
      if (entry === null) set.add([], [UNNAMED]);
      else runner.push(entry);
    }
    set.add(runner);
    return set.packages(runner);
  }

  /**
   * D4: `direct` is every changed test file and every test file that imports
   * a changed path in one hop (or read it, or probed it as a candidate);
   * `transitive` the other test files whose closure holds a changed path or
   * whose last run loaded it; every test file when a preload's closure holds
   * one or a preload loaded it at run time.
   */
  affected(changed: readonly RelativePath[]): AffectedPaths {
    const index = this.current();
    const direct = new Set<AbsolutePath>();
    const transitive = new Set<AbsolutePath>();
    for (const path of changed.map((p) => this.abs(p))) {
      if (index.test(path) !== undefined) direct.add(path);
      if (index.has(index.preload, path) || this.observedPreloads.has(path)) {
        for (const file of this.testFiles) transitive.add(file);
      }
      for (const file of index.holders(path)) {
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

  recordObservedPreloads(paths: readonly RelativePath[]): void {
    this.observedPreloads = new Set(paths.map((p) => this.abs(p)));
  }

  /** Each test file whose static closure is incomplete, with its reasons, in listing order. */
  incompleteClosures(): readonly (readonly [RelativePath, readonly string[]])[] {
    const index = this.current();
    return this.testFiles.flatMap((file) => {
      const reasons = index.incomplete(index.test(file) ?? new Uint32Array());
      return reasons.length === 0 ? [] : [[this.rel(file), reasons] as const];
    });
  }

  /** The `.js`/`.ts` pairs that the modules of current closures meet under tsx. */
  pairs(): readonly (readonly [RelativePath, RelativePath])[] {
    const index = this.current();
    const seen = new Map<string, readonly [RelativePath, RelativePath]>();
    for (const path of index.paths) {
      for (const [js, ts] of this.table.node(path)?.pairs ?? []) {
        seen.set(js, [this.rel(js), this.rel(ts)]);
      }
    }
    return [...seen.values()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  }

  private current(): ClosureIndex {
    this.index ??= new ClosureIndex(
      (file) => this.table.node(file),
      this.testFiles,
      this.preloadRoots,
      this.preloadExtra,
      (path) => this.rel(path),
    );
    return this.index;
  }

  /**
   * D1 as amended (S3): every preload resolves from `cwd`. One that resolves
   * to a worktree module, a symlinked workspace package included, roots the
   * preload closure; a bare one under `node_modules` is the installed-
   * dependency fingerprint's and gets the unrecognized-loader note.
   */
  private resolvePreloads(): void {
    this.preloadRoots.length = 0;
    this.preloadIncomplete = [];
    this.preloadExtra = [];
    this.outsidePreloads = [];
    const from = join(this.cwd, "[argv]");
    for (const { specifier, kind, path } of this.chain.preloads) {
      const resolution = this.resolver.resolve(specifier, from, kind);
      const inside = resolution.path !== null && this.table.inWorktree(resolution.path);
      if (resolution.path === null) {
        this.preloadIncomplete.push(`preload ${JSON.stringify(specifier)} does not resolve`);
      }
      if (inside || (path && resolution.path !== null)) {
        this.preloadRoots.push(resolution.path as AbsolutePath);
      } else if (!path) {
        this.outsidePreloads.push(specifier);
      }
      this.preloadExtra.push(...resolution.reads, ...resolution.candidates);
    }
  }

  /** Notes for the preloads, by {@link preloadNotes}. */
  preloadNotes(): string[] {
    return preloadNotes({
      table: this.table,
      roots: this.preloadRoots,
      outside: this.outsidePreloads,
      rules: this.chain.rules,
      rel: (path) => this.rel(path),
    });
  }

  private collect(index: ClosureIndex, bits: Uint32Array): PackageSet {
    const set = new PackageSet();
    index.each(bits, (path) => {
      const node = this.table.node(path);
      if (node !== undefined) set.add(node.packages, node.builtins);
    });
    return set;
  }

  private present(index: ClosureIndex, bits: Uint32Array, extra: readonly string[]) {
    const incomplete = [...extra, ...index.incomplete(bits)];
    return {
      paths: index.members(bits),
      complete: incomplete.length === 0,
      incomplete,
    };
  }

  /** A file some resolution read, such as a tsconfig `extends` target, changes resolution. */
  private isRead(path: AbsolutePath): boolean {
    if (this.table.node(path) !== undefined) return false;
    const index = this.current();
    return index.holders(path).length > 0 || index.has(index.preload, path);
  }

  private sorted(paths: Iterable<AbsolutePath>): RelativePath[] {
    return [...paths].map((p) => this.rel(p)).sort();
  }

  private abs(path: RelativePath): AbsolutePath {
    return join(this.root, path);
  }

  /** Every graph path is under the root: a slice, not `path.relative` (100k calls per build). */
  private rel(path: AbsolutePath): RelativePath {
    return path.startsWith(this.prefix)
      ? path.slice(this.prefix.length)
      : relative(this.root, path);
  }
}
