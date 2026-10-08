import { readFileSync } from "node:fs";
import { dirname, relative, sep } from "node:path";
import type { AbsolutePath, PackageImport } from "../../../core/types/index.js";
import { expandGlob } from "./glob.js";
import { builtinName, installedPackage, packageImport, UNNAMED } from "./packages.js";
import { PARSED_EXTENSION, type ParsedModule, type ParsedSpecifier, parseModule } from "./parse.js";
import type { Resolver } from "./resolver.js";

/** One module's resolved edges. */
export interface ModuleNode {
  /** Worktree modules it imports, glob matches included. */
  readonly deps: ReadonlySet<AbsolutePath>;
  /** `package.json` and `tsconfig.json` files its resolutions read. */
  readonly reads: ReadonlySet<AbsolutePath>;
  /** Absent candidates of its unresolved specifiers. */
  readonly candidates: ReadonlySet<AbsolutePath>;
  readonly incomplete: readonly string[];
  /** `.js`/`.ts` pairs its imports met under tsx, `[js, ts]`. */
  readonly pairs: readonly (readonly [AbsolutePath, AbsolutePath])[];
  /**
   * Installed packages it loads (task 003-22): for a specifier that resolves
   * under the worktree's `node_modules`, the package of the resolved file,
   * looked up from the directory holding that `node_modules`, whatever the
   * specifier (task 003-33, review wave-3 B1); for a bare one that resolves
   * nowhere (keyed as absent) or outside the worktree, the package it names,
   * looked up from its directory. Not one that resolves to a project file
   * such as a workspace link.
   */
  readonly packages: readonly PackageImport[];
  /** Builtins it imports, by name; `module` too when it loads something no specifier names. */
  readonly builtins: readonly string[];
}

const NO_PARSE: ParsedModule = { specifiers: [], incomplete: [], unnamed: false };

/**
 * Parses and resolves the worktree's modules: a parse cache that survives a
 * resolver clear (D4: re-resolve from cached parses) and the resolved nodes.
 */
export class ModuleTable {
  private readonly parses = new Map<AbsolutePath, ParsedModule>();
  private nodes = new Map<AbsolutePath, ModuleNode>();

  constructor(
    private readonly root: AbsolutePath,
    private readonly resolver: Resolver,
    private readonly tsx: boolean,
  ) {}

  node(file: AbsolutePath): ModuleNode | undefined {
    return this.nodes.get(file);
  }

  /** Resolves every module reachable from `roots` that has no node yet. */
  reach(roots: Iterable<AbsolutePath>): void {
    const queue = [...roots];
    for (let file = queue.pop(); file !== undefined; file = queue.pop()) {
      if (this.nodes.has(file)) continue;
      const node = this.resolveModule(file);
      this.nodes.set(file, node);
      for (const dep of node.deps) if (!this.nodes.has(dep)) queue.push(dep);
    }
  }

  /**
   * Re-parses and re-resolves one module; true when its edges changed. An
   * unreached module only loses its cached parse, so a later reach reads it.
   */
  reparse(file: AbsolutePath): boolean {
    this.parses.delete(file);
    const before = this.nodes.get(file);
    if (before === undefined) return false;
    const after = this.resolveModule(file);
    this.nodes.set(file, after);
    if (sameEdges(before, after)) return false;
    this.reach(after.deps);
    return true;
  }

  /** Forgets parses (of deleted or edited files) and every node; parses kept elsewhere are reused. */
  reset(forget: Iterable<AbsolutePath>): void {
    for (const file of forget) this.parses.delete(file);
    this.nodes = new Map();
  }

  private parsed(file: AbsolutePath): ParsedModule {
    let parsed = this.parses.get(file);
    if (parsed === undefined) {
      parsed = NO_PARSE;
      if (PARSED_EXTENSION.test(file)) {
        try {
          parsed = parseModule(readFileSync(file, "utf8"), relative(this.root, file));
        } catch {
          // A file that vanished between listing and reading: a later delete re-resolves.
        }
      }
      this.parses.set(file, parsed);
    }
    return parsed;
  }

  private resolveModule(file: AbsolutePath): ModuleNode {
    const parsed = this.parsed(file);
    const deps = new Set<AbsolutePath>();
    const reads = new Set<AbsolutePath>();
    const candidates = new Set<AbsolutePath>();
    const incomplete = [...parsed.incomplete];
    const pairs: (readonly [AbsolutePath, AbsolutePath])[] = [];
    const packages: PackageImport[] = [];
    const builtins = new Set<string>(parsed.unnamed ? [UNNAMED] : []);
    const from = this.relativeDir(file);
    const format = this.tsx ? this.resolver.moduleFormat(file) : null;
    if (format?.manifest != null && parsed.specifiers.length > 0) reads.add(format.manifest);
    for (const { specifier, kind: written, dynamic } of parsed.specifiers) {
      if (written === "glob") {
        const matches = expandGlob(specifier, file, this.tsx);
        // B2: a glob with no static form can load any installed file.
        if (matches === null) {
          incomplete.push(
            `import(\`${specifier}\`) in ${relative(this.root, file)} has no static glob`,
          );
          builtins.add(UNNAMED);
        }
        for (const match of matches ?? []) {
          if (this.inWorktree(match)) deps.add(match);
          else this.installed(match, packages, builtins);
        }
        continue;
      }
      // S2: a static import tsx compiles to `require` resolves with the `require` conditions.
      const kind =
        written === "import" && !dynamic && format?.format === "commonjs" ? "require" : written;
      const resolution = this.resolver.resolve(specifier, file, kind);
      const target = resolution.path;
      if (resolution.builtin) builtins.add(builtinName(specifier));
      else if (target !== null && this.inWorktree(target)) deps.add(target);
      else if (target === null || !this.installed(target, packages, builtins)) {
        const entry = from === null ? null : packageImport(from, specifier);
        if (entry !== null) packages.push(entry);
      }
      for (const read of resolution.reads) reads.add(read);
      for (const candidate of resolution.candidates) candidates.add(candidate);
      if (resolution.pair !== null) pairs.push(resolution.pair);
    }
    return { deps, reads, candidates, incomplete, pairs, packages, builtins: [...builtins] };
  }

  /**
   * Review wave-3 B1: records the package an installed `path` belongs to,
   * whatever specifier reached it (a `#` alias, a relative path, a tsconfig
   * alias), or `module` for a file under `node_modules` in no package. False
   * for a path outside the worktree, which no install of it holds: the
   * written bare specifier stands in for it.
   */
  private installed(path: AbsolutePath, packages: PackageImport[], builtins: Set<string>): boolean {
    if (!path.startsWith(this.root + sep)) return false;
    const entry = installedPackage(
      path
        .slice(this.root.length + 1)
        .split(sep)
        .join("/"),
    );
    if (entry === null) builtins.add(UNNAMED);
    else packages.push(entry);
    return true;
  }

  /** A module's directory relative to the root, `""` for the root, `null` outside it. */
  private relativeDir(file: AbsolutePath): string | null {
    const dir = dirname(file);
    if (dir === this.root) return "";
    return dir.startsWith(this.root + sep)
      ? dir
          .slice(this.root.length + 1)
          .split(sep)
          .join("/")
      : null;
  }

  /** The specifiers `file` was parsed to, for a preload's hooks check. */
  specifiers(file: AbsolutePath): readonly ParsedSpecifier[] {
    return this.parsed(file).specifiers;
  }

  /** Inside the worktree and outside every `node_modules`. */
  inWorktree(path: AbsolutePath): boolean {
    return path.startsWith(this.root + sep) && !path.includes(`${sep}node_modules${sep}`);
  }
}

function sameEdges(a: ModuleNode, b: ModuleNode): boolean {
  return (
    sameSet(a.deps, b.deps) &&
    sameSet(a.reads, b.reads) &&
    sameSet(a.candidates, b.candidates) &&
    a.incomplete.join("\n") === b.incomplete.join("\n") &&
    a.pairs.flat().join("\n") === b.pairs.flat().join("\n")
  );
}

const sameSet = <T>(a: ReadonlySet<T>, b: ReadonlySet<T>) =>
  a.size === b.size && [...a].every((x) => b.has(x));
