import { readFileSync } from "node:fs";
import { relative, sep } from "node:path";
import type { AbsolutePath } from "../../../core/types/index.js";
import { expandGlob } from "./glob.js";
import { PARSED_EXTENSION, type ParsedModule, parseModule } from "./parse.js";
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
}

const NO_PARSE: ParsedModule = { specifiers: [], incomplete: [] };

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
    for (const { specifier, kind } of parsed.specifiers) {
      if (kind === "glob") {
        const matches = expandGlob(specifier, file, this.tsx);
        if (matches === null) {
          incomplete.push(
            `import(\`${specifier}\`) in ${relative(this.root, file)} has no static glob`,
          );
        }
        for (const match of matches ?? []) if (this.inWorktree(match)) deps.add(match);
        continue;
      }
      const resolution = this.resolver.resolve(specifier, file, kind);
      for (const read of resolution.reads) reads.add(read);
      for (const candidate of resolution.candidates) candidates.add(candidate);
      if (resolution.pair !== null) pairs.push(resolution.pair);
      if (resolution.path !== null && this.inWorktree(resolution.path)) deps.add(resolution.path);
    }
    return { deps, reads, candidates, incomplete, pairs };
  }

  private inWorktree(path: AbsolutePath): boolean {
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
