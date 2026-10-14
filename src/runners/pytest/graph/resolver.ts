import { statSync } from "node:fs";
import { dirname, join, sep } from "node:path";
import type { AbsolutePath } from "../../../core/types/index.js";
import type { SearchPath } from "./search-path.js";

/** What the import system would find for a module name, without running anything. */
interface Spec {
  /** The file that runs: a module, a package's `__init__.py`; `null` for a namespace or the stdlib. */
  readonly origin: AbsolutePath | null;
  /** A package's `__path__`; `null` for a plain module. */
  readonly sub: readonly AbsolutePath[] | null;
}

/**
 * Every spec a name can have and the absent candidates of every way to look
 * it up: more than one spec where a batch decides, since pytest inserts
 * basedirs in its own order and the first import of a name is cached for the
 * rest of the process (review 007-16 B2). Empty specs: the name does not
 * resolve.
 */
interface Found {
  readonly specs: readonly Spec[];
  readonly candidates: readonly AbsolutePath[];
}

/** The worktree files and absent candidates one dotted name reaches. */
export interface Resolution {
  readonly files: readonly AbsolutePath[];
  readonly candidates: readonly AbsolutePath[];
  /** False when the name does not resolve; its candidates are still listed. */
  readonly resolved: boolean;
}

const STDLIB: Spec = { origin: null, sub: [] };

/**
 * Spec 007 D4's resolver over a {@link SearchPath}: `PathFinder` order,
 * namespace portions built by the resolver itself, then the editable
 * finders' mappings; module-graph Q1's `node_graph.mjs` with 007-04's
 * candidate rule, under which a winner outside the worktree does not end
 * the scan. Stat and spec caches live until {@link clear}.
 */
export class Resolver {
  private readonly stats = new Map<string, 0 | 1 | 2>();
  private readonly specs = new Map<string, Found>();
  private readonly prefix: string;

  constructor(
    private readonly root: AbsolutePath,
    private readonly env: AbsolutePath | null,
    private path: SearchPath,
  ) {
    this.prefix = root + sep;
  }

  /** Drops every cache, after a structural change, with the search path rebuilt. */
  reset(path: SearchPath): void {
    this.path = path;
    this.stats.clear();
    this.specs.clear();
  }

  /** `import a.b.c`: the files of `a`, `a.b` and `a.b.c`, and each step's candidates. */
  resolve(name: string): Resolution {
    const files: AbsolutePath[] = [];
    const candidates: AbsolutePath[] = [];
    const parts = name.split(".");
    for (let k = 1; k <= parts.length; k++) {
      const found = this.find(parts.slice(0, k).join("."));
      candidates.push(...found.candidates);
      if (found.specs.length === 0) return { files, candidates, resolved: false };
      files.push(...this.origins(found));
    }
    return { files, candidates, resolved: true };
  }

  /** `from a import b` after `a` resolved: `a.b` when it is a submodule, else a name. */
  member(name: string): Resolution {
    const found = this.find(name);
    return {
      files: this.origins(found),
      candidates: [...found.candidates],
      resolved: found.specs.length > 0,
    };
  }

  /** Inside the worktree and outside its environment. */
  inside(path: AbsolutePath): boolean {
    if (!path.startsWith(this.prefix)) return false;
    if (this.env !== null && (path === this.env || path.startsWith(this.env + sep))) return false;
    return !path
      .slice(this.prefix.length)
      .split(sep)
      .some((part) => part.startsWith(".venv"));
  }

  isFile(path: string): boolean {
    return this.kind(path) === 1;
  }

  private find(name: string): Found {
    let found = this.specs.get(name);
    if (found !== undefined) return found;
    const dot = name.lastIndexOf(".");
    if (dot < 0) found = this.findTop(name);
    else {
      const last = name.slice(dot + 1);
      const specs: Spec[] = [];
      const candidates: AbsolutePath[] = [];
      for (const parent of this.find(name.slice(0, dot)).specs) {
        if (!parent.sub) continue;
        const spec = this.findIn(last, parent.sub);
        if (spec !== null) specs.push(spec);
        candidates.push(...this.absent(parent.sub, last, spec));
      }
      found = { specs, candidates };
    }
    this.specs.set(name, found);
    return found;
  }

  /**
   * `PathFinder` over the search path, then the editable finders. A hit in
   * a basedir pytest inserts is one possible spec and the scan goes on; the
   * first hit elsewhere ends it.
   */
  private findTop(name: string): Found {
    const portions: AbsolutePath[] = [];
    const specs: Spec[] = [];
    let last: Spec | null = null;
    for (const location of this.path.locations) {
      if (location.kind === "stdlib") {
        // A regular module anywhere on the path wins over namespace portions found before it.
        if (location.names.has(name)) last = STDLIB;
      } else {
        const found = this.lookIn(location.dir, name, portions);
        if (found !== null && location.basedir) specs.push(found);
        else last = found;
      }
      if (last !== null) break;
    }
    last ??= this.mapped(name);
    if (last === null && portions.length > 0) last = namespace(portions);
    if (last !== null) specs.push(last);
    const dirs = this.path.locations.flatMap((l) => (l.kind === "dir" ? [l.dir] : []));
    return { specs, candidates: this.absent(dirs, name, last) };
  }

  private mapped(name: string): Spec | null {
    for (const mapped of this.path.mapped) {
      if (mapped.module !== name) continue;
      if (mapped.finder === "setuptools" && this.kind(mapped.path) === 2) {
        return { origin: join(mapped.path, "__init__.py"), sub: [mapped.path] };
      }
      const isInit = mapped.path.endsWith(`${sep}__init__.py`);
      return { origin: mapped.path, sub: isInit ? [dirname(mapped.path)] : null };
    }
    return null;
  }

  private findIn(last: string, locations: readonly AbsolutePath[]): Spec | null {
    const portions: AbsolutePath[] = [];
    for (const location of locations) {
      const found = this.lookIn(location, last, portions);
      if (found !== null) return found;
    }
    return portions.length > 0 ? namespace(portions) : null;
  }

  private origins(found: Found): AbsolutePath[] {
    return found.specs.flatMap((s) =>
      s.origin !== null && this.inside(s.origin) ? [s.origin] : [],
    );
  }

  /** `FileFinder` in one directory: a regular package, then a module; a bare directory is a portion. */
  private lookIn(dir: AbsolutePath, last: string, portions: AbsolutePath[]): Spec | null {
    const pkg = join(dir, last);
    const init = join(pkg, "__init__.py");
    if (this.kind(init) === 1) return { origin: init, sub: [pkg] };
    if (this.kind(`${pkg}.py`) === 1) return { origin: `${pkg}.py`, sub: null };
    if (this.kind(pkg) === 2) portions.push(pkg);
    return null;
  }

  /**
   * D4 as amended: the absent `<loc>/<last>.py` and `<loc>/<last>/__init__.py`
   * in each worktree location before the one `won` came from; a winner
   * outside the worktree, the stdlib or site-packages, does not end the scan.
   */
  private absent(
    locations: readonly AbsolutePath[],
    last: string,
    won: Spec | null,
  ): AbsolutePath[] {
    const at = won?.origin != null && this.inside(won.origin) ? dirname(won.origin) : null;
    const found: AbsolutePath[] = [];
    for (const location of locations) {
      if (at !== null && (at === location || at === join(location, last))) break;
      if (!this.inside(location) && location !== this.root) continue;
      for (const path of [join(location, `${last}.py`), join(location, last, "__init__.py")]) {
        if (this.kind(path) !== 1) found.push(path);
      }
    }
    return found;
  }

  /** 0 absent, 1 a file, 2 a directory. */
  private kind(path: string): 0 | 1 | 2 {
    let kind = this.stats.get(path);
    if (kind === undefined) {
      try {
        kind = statSync(path).isFile() ? 1 : 2;
      } catch {
        kind = 0;
      }
      this.stats.set(path, kind);
    }
    return kind;
  }
}

function namespace(portions: readonly AbsolutePath[]): Spec {
  return { origin: null, sub: portions };
}
