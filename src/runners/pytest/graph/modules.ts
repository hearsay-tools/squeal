import { readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { AbsolutePath } from "../../../core/types/index.js";
import { type ParsedPython, parsePython } from "./parse.js";
import type { Resolution, Resolver } from "./resolver.js";

/** One parsed and resolved module of the worktree (spec 007 D4). */
export interface ModuleNode {
  readonly path: AbsolutePath;
  /** Worktree files it loads: its parent packages' `__init__.py`, then every import's chain. */
  readonly deps: ReadonlySet<AbsolutePath>;
  /** Files of its `pytest_plugins` modules, followed when pytest loads it as a test, conftest or plugin. */
  readonly plugins: ReadonlySet<AbsolutePath>;
  /** Absent paths that would change what an import or a plugin resolves to. */
  readonly candidates: ReadonlySet<AbsolutePath>;
  /** Why a closure through this module is incomplete, with the line. */
  readonly incomplete: readonly string[];
}

/**
 * Parses kept per path across structural changes, resolutions per
 * resolver generation: a content edit re-parses one file, a structural
 * change re-resolves every module from cached parses (D5).
 */
export class ModuleTable {
  private readonly parses = new Map<AbsolutePath, ParsedPython | null>();
  private readonly nodes = new Map<AbsolutePath, ModuleNode | null>();
  private readonly names = new Map<AbsolutePath, string>();

  constructor(
    private readonly resolver: Resolver,
    private readonly rel: (path: AbsolutePath) => string,
  ) {}

  node(path: AbsolutePath): ModuleNode | undefined {
    return this.nodes.get(path) ?? undefined;
  }

  /** Every resolved module. */
  paths(): IterableIterator<AbsolutePath> {
    return this.nodes.keys();
  }

  /** Parses and resolves every module reachable from `roots` not yet in the table. */
  reach(roots: readonly AbsolutePath[]): void {
    const todo = [...roots];
    while (todo.length > 0) {
      const path = todo.pop() as AbsolutePath;
      if (this.nodes.has(path)) continue;
      const node = this.resolve(path);
      this.nodes.set(path, node);
      if (node === null) continue;
      for (const dep of node.deps) if (!this.nodes.has(dep)) todo.push(dep);
      for (const dep of node.plugins) if (!this.nodes.has(dep)) todo.push(dep);
    }
  }

  /**
   * A content change: re-parses `path` and re-resolves it. True when the
   * module's edges or reasons changed, so closures must be rebuilt.
   */
  reparse(path: AbsolutePath): boolean {
    if (!this.nodes.has(path)) return false;
    const before = this.nodes.get(path) ?? null;
    this.parses.delete(path);
    this.nodes.delete(path);
    this.reach([path]);
    return !sameNode(before, this.nodes.get(path) ?? null);
  }

  /** A structural change: every resolution goes; parses stay, but of `dropped` paths. */
  reset(dropped: readonly AbsolutePath[]): void {
    this.nodes.clear();
    this.names.clear();
    for (const path of dropped) this.parses.delete(path);
  }

  private parse(path: AbsolutePath): ParsedPython | null {
    let parsed = this.parses.get(path);
    if (parsed === undefined) {
      let source: string | null = null;
      try {
        source = readFileSync(path, "utf8");
      } catch {}
      parsed = source === null ? null : parsePython(source);
      this.parses.set(path, parsed);
    }
    return parsed;
  }

  /** `ast_graph.py`'s per-file resolution, plus `pytest_plugins`. */
  private resolve(path: AbsolutePath): ModuleNode | null {
    const parsed = this.parse(path);
    if (parsed === null) return null;
    const name = this.moduleName(path);
    const isPackage = basename(path) === "__init__.py";
    const parts = name.split(".");
    const pkg = isPackage ? parts : parts.slice(0, -1);
    const deps = new Set<AbsolutePath>();
    const candidates = new Set<AbsolutePath>();
    const add = (r: Resolution, into: Set<AbsolutePath>) => {
      for (const file of r.files) into.add(file);
      for (const c of r.candidates) candidates.add(c);
    };
    // Loading a.b.c runs a/__init__.py and a/b/__init__.py first, whoever imports it.
    let dir = isPackage ? dirname(dirname(path)) : dirname(path);
    for (let k = 0; k < parts.length - 1; k++) {
      deps.add(join(dir, "__init__.py"));
      dir = dirname(dir);
    }
    const incomplete: string[] = [];
    const where = (line: number) => `${this.rel(path)}:${line}`;
    for (const line of parsed.computed) incomplete.push(`${where(line)}: computed import`);
    if (parsed.errorLine !== null) incomplete.push(`${where(parsed.errorLine)}: does not parse`);
    for (const { module, level, names } of parsed.imports) {
      let target = module;
      if (level > 0) {
        // Beyond the top-level package: Python raises, nothing loads.
        if (level - 1 >= pkg.length) continue;
        const base = pkg.slice(0, pkg.length - (level - 1)).join(".");
        target = module === "" ? base : `${base}.${module}`;
      }
      const chain = this.resolver.resolve(target);
      add(chain, deps);
      if (!chain.resolved) continue;
      for (const n of names) add(this.resolver.member(`${target}.${n}`), deps);
    }
    const plugins = new Set<AbsolutePath>();
    for (const plugin of parsed.pytestPlugins) add(this.resolver.resolve(plugin), plugins);
    if (parsed.pytestPluginsComputed !== null) {
      incomplete.push(`${where(parsed.pytestPluginsComputed)}: computed pytest_plugins`);
    }
    deps.delete(path);
    plugins.delete(path);
    return { path, deps, plugins, candidates, incomplete };
  }

  /** pytest's module name under `prepend`: the path below the first directory upward without `__init__.py`. */
  private moduleName(path: AbsolutePath): string {
    const dir = dirname(path);
    let parent = this.names.get(dir);
    if (parent === undefined) {
      parent = this.isFile(join(dir, "__init__.py")) ? this.packageName(dir) : "";
      this.names.set(dir, parent);
    }
    const stem = basename(path, ".py");
    if (stem === "__init__") return parent;
    return parent === "" ? stem : `${parent}.${stem}`;
  }

  private packageName(dir: AbsolutePath): string {
    const up = dirname(dir);
    let parent = this.names.get(up);
    if (parent === undefined) {
      parent = this.isFile(join(up, "__init__.py")) ? this.packageName(up) : "";
      this.names.set(up, parent);
    }
    return parent === "" ? basename(dir) : `${parent}.${basename(dir)}`;
  }

  private isFile(path: AbsolutePath): boolean {
    return this.parses.has(path) || this.resolver.isFile(path);
  }
}

function sameNode(a: ModuleNode | null, b: ModuleNode | null): boolean {
  if (a === null || b === null) return a === b;
  return (
    sameSet(a.deps, b.deps) &&
    sameSet(a.plugins, b.plugins) &&
    sameSet(a.candidates, b.candidates) &&
    a.incomplete.join("\n") === b.incomplete.join("\n")
  );
}

function sameSet<T>(a: ReadonlySet<T>, b: ReadonlySet<T>): boolean {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}
