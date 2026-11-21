import * as fs from "node:fs";
import { isBuiltin } from "node:module";
import { dirname, extname, join, resolve as resolvePath, sep } from "node:path";
import enhanced from "enhanced-resolve";
import type { AbsolutePath } from "../../../core/types/common.js";
import type { LoaderChain } from "./loader-chain.js";
import {
  aliasCandidates,
  compileAliases,
  type PathAliases,
  parseJsonc,
  readTsconfigPaths,
  type TsconfigPaths,
  tsxSpecifier,
} from "./tsconfig.js";

export type EdgeKind = "import" | "require";

/** One specifier resolved from one importer. */
export interface Resolution {
  /** Real path of the target; `null` when it did not resolve or is a builtin. */
  readonly path: AbsolutePath | null;
  readonly builtin: boolean;
  /** Real paths of every `package.json` and `tsconfig.json` the resolution read, inside the worktree. */
  readonly reads: readonly AbsolutePath[];
  /** For an unresolved specifier, every absent candidate probed inside the worktree (001 D3). */
  readonly candidates: readonly AbsolutePath[];
  /** Set when tsx resolved `./a.js` to `a.ts` while `a.js` exists too (open question 1). */
  readonly pair: readonly [AbsolutePath, AbsolutePath] | null;
}

/** How tsx loads one module, and the `package.json` that decided it, if any. */
export interface ModuleFormat {
  readonly format: "module" | "commonjs";
  /** The nearest `package.json` inside the worktree, when its `type` decided the format. */
  readonly manifest: AbsolutePath | null;
}

export interface Resolver {
  resolve(specifier: string, importer: AbsolutePath, kind: EdgeKind): Resolution;
  /**
   * D3 as amended (S2): tsx compiles `.cts`, `.cjs`, and a `.ts`, `.tsx`,
   * `.js` or `.jsx` whose nearest `package.json` has no `"type": "module"` to
   * CommonJS, so its static imports resolve with the `require` conditions.
   */
  moduleFormat(file: AbsolutePath): ModuleFormat;
  /** Releases build-only filesystem and resolver caches; keeps compact lookup summaries for edits. */
  release(): void;
  /** Drops every cached stat, read and resolver (D4: on add, delete, manifest change). */
  clear(): void;
}

/** tsx's lookup order (research, module-graph Q1), and `extensionAlias` for `.js` meaning `.ts`. */
const TSX_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".mjs", ".cjs", ".json"];
const TSX_ALIAS: Record<string, string[]> = {
  ".js": [".ts", ".tsx", ".js"],
  ".mjs": [".mts", ".mjs"],
  ".cjs": [".cts", ".cjs"],
};
/** `require` without tsx: Node's CJS extensions, plus the ones type stripping registers. */
const NODE_REQUIRE_EXTENSIONS = [".js", ".json", ".node", ".ts", ".cts", ".mts"];

const NODE_MODULES = `${sep}node_modules${sep}`;
const NODE_MODULES_DIR = `${sep}node_modules`;
const COMMONJS = /\.c[jt]s$/;
const MODULE = /\.m[jt]s$/;

type ResolveContext = Parameters<
  ReturnType<typeof enhanced.ResolverFactory.createResolver>["resolve"]
>[3];

const BUILTIN: Resolution = { path: null, builtin: true, reads: [], candidates: [], pair: null };

/** Where tsx finds its tsconfig: the process's directory, or `TSX_TSCONFIG_PATH`. */
export interface TsconfigSource {
  /** The project's `cwd`; the worktree root when not given. */
  readonly cwd?: AbsolutePath;
  /** The project's `TSX_TSCONFIG_PATH`, relative to `cwd` when not absolute. */
  readonly tsconfigPath?: string | undefined;
}

/** The one tsconfig tsx reads for the process: its chain, and its aliases. */
interface ProjectTsconfig {
  readonly chain: TsconfigPaths;
  readonly aliases: PathAliases | null;
}

/**
 * One enhanced-resolve resolver per `import|require`, configured from the
 * project's loader chain (spec 003 D3), over one `CachedInputFileSystem`.
 * Row 018-66: as tsx 4 does, one tsconfig serves the process,
 * `TSX_TSCONFIG_PATH` or else the nearest `tsconfig.json` from `cwd` up
 * (stopping at the worktree root), and its `paths` and `baseUrl` map the
 * specifiers of every importer outside `node_modules`, wherever it sits.
 * Node's own rules read no tsconfig.
 */
export function createResolver(
  chain: LoaderChain,
  root: AbsolutePath,
  source: TsconfigSource = {},
): Resolver {
  let fileSystem = new enhanced.CachedInputFileSystem(fs, Number.POSITIVE_INFINITY);
  let resolvers = new Map<string, ReturnType<typeof enhanced.ResolverFactory.createResolver>>();
  let tsconfigs = new Map<string, AbsolutePath | null>();
  let realpaths = new Map<string, AbsolutePath | null>();
  let resolutions = new Map<string, Resolution>();
  let tsconfigPaths = new Map<AbsolutePath, TsconfigPaths>();
  const aliasesOf = new WeakMap<TsconfigPaths, PathAliases | null>();
  let scopes = new Map<string, ModuleFormat>();
  const tsx = chain.rules === "tsx";

  const exists = (path: string) => {
    try {
      return fileSystem.statSync(path).isFile();
    } catch {
      return false;
    }
  };
  const isDirectory = (path: string) => {
    try {
      return fileSystem.statSync(path).isDirectory();
    } catch {
      return false;
    }
  };
  const real = (path: string) => {
    let found = realpaths.get(path);
    if (found === undefined) {
      try {
        found = fs.realpathSync.native(path);
      } catch {
        found = null;
      }
      realpaths.set(path, found);
    }
    return found;
  };
  const readText = (path: string) => {
    try {
      return fileSystem.readFileSync(path).toString("utf8");
    } catch {
      return null;
    }
  };
  /** The nearest `package.json` type above `dir`, cached per directory. */
  const scopeOf = (dir: string): ModuleFormat => {
    let found = scopes.get(dir);
    if (found === undefined) {
      const manifest = join(dir, "package.json");
      const text = readText(manifest);
      const parent = dirname(dir);
      if (text !== null) {
        const type = parseJsonc(text)?.type;
        found = {
          format: type === "module" ? "module" : "commonjs",
          manifest: inWorktree(manifest) ? manifest : null,
        };
      } else {
        found = parent === dir ? { format: "commonjs", manifest: null } : scopeOf(parent);
      }
      scopes.set(dir, found);
    }
    return found;
  };
  const tsconfigFor = (dir: string): AbsolutePath | null => {
    let found = tsconfigs.get(dir);
    if (found === undefined) {
      const here = join(dir, "tsconfig.json");
      const parent = dirname(dir);
      found = exists(here) ? here : dir === root || parent === dir ? null : tsconfigFor(parent);
      tsconfigs.set(dir, found);
    }
    return found;
  };
  const cwd = source.cwd ?? root;
  /**
   * The process's tsconfig under tsx, `null` under Node's rules or with none.
   * Its chain is read once per `clear`, which drops `tsconfigPaths`.
   */
  const projectTsconfig = (): ProjectTsconfig | null => {
    const file = source.tsconfigPath ? resolvePath(cwd, source.tsconfigPath) : tsconfigFor(cwd);
    if (!tsx || file === null) return null;
    let read = tsconfigPaths.get(file);
    if (read === undefined) {
      read = readTsconfigPaths(file, readText);
      tsconfigPaths.set(file, read);
      aliasesOf.set(read, compileAliases(read, readText));
    }
    return { chain: read, aliases: aliasesOf.get(read) ?? null };
  };
  const resolverFor = (kind: EdgeKind) => {
    let resolver = resolvers.get(kind);
    if (resolver === undefined) {
      resolver = enhanced.ResolverFactory.createResolver({
        fileSystem,
        useSyncFileSystemCalls: true,
        conditionNames: ["node", kind, ...chain.conditions],
        symlinks: true,
        ...(tsx
          ? { extensions: TSX_EXTENSIONS, extensionAlias: TSX_ALIAS }
          : kind === "import"
            ? { extensions: [], fullySpecified: true }
            : { extensions: NODE_REQUIRE_EXTENSIONS }),
      });
      resolvers.set(kind, resolver);
    }
    return resolver;
  };
  /** tsx maps no alias for an importer under `node_modules`. */
  const inDependency = (dir: string) => `${dir}${sep}`.includes(NODE_MODULES);
  // An absent `node_modules` directory probed on the way up is no candidate either (N3).
  function inWorktree(path: string): boolean {
    return (
      path.startsWith(root + sep) &&
      !path.includes(NODE_MODULES) &&
      !path.endsWith(NODE_MODULES_DIR)
    );
  }

  return {
    resolve(specifier, importer, kind) {
      const from = dirname(importer);
      // One directory resolves a specifier one way: modules beside each other share it.
      const key = `${from}\0${kind}\0${specifier}`;
      let resolution = resolutions.get(key);
      if (resolution === undefined) {
        resolution = resolveFrom(specifier, from, kind);
        resolutions.set(key, resolution);
      }
      return resolution;
    },
    moduleFormat(file) {
      if (COMMONJS.test(file)) return { format: "commonjs", manifest: null };
      if (MODULE.test(file)) return { format: "module", manifest: null };
      return scopeOf(dirname(file));
    },
    release() {
      fileSystem.purge();
      resolvers.clear();
    },
    clear() {
      fileSystem = new enhanced.CachedInputFileSystem(fs, Number.POSITIVE_INFINITY);
      resolvers = new Map();
      tsconfigs = new Map();
      realpaths = new Map();
      resolutions = new Map();
      tsconfigPaths = new Map();
      scopes = new Map();
    },
  };

  function resolveFrom(specifier: string, from: AbsolutePath, kind: EdgeKind): Resolution {
    const config = projectTsconfig();
    const context = {
      fileDependencies: new Set<string>(),
      missingDependencies: new Set<string>(),
      contextDependencies: new Set<string>(),
    };
    const asked = tsx ? tsxSpecifier(specifier, kind) : specifier;
    const target = targetOf(asked, from, kind, config?.aliases ?? null, context);
    if (target === null) return BUILTIN;
    // `symlinks: true` already gives the target's real path.
    const path = target === false ? null : target;
    const reads = new Set<AbsolutePath>((config?.chain.files ?? []).filter(inWorktree));
    for (const dependency of context.fileDependencies) {
      if (!dependency.endsWith(".json") || dependency === target) continue;
      // A manifest read through a workspace symlink counts at its real path.
      const read = dependency.includes(NODE_MODULES) ? real(dependency) : dependency;
      if (read !== null && read !== path && inWorktree(read)) reads.add(read);
    }
    // A directory probed as a file is not a candidate: no file can appear there.
    const candidates =
      path === null
        ? [...context.missingDependencies].filter((p) => inWorktree(p) && !isDirectory(p))
        : [];
    return { path, builtin: false, reads: [...reads], candidates, pair: pairOf(asked, path) };
  }

  /**
   * As tsx resolves: each alias target first, then the specifier (under tsx
   * without its query, `tsxSpecifier`); `null` for a builtin no alias target
   * shadows.
   */
  function targetOf(
    specifier: string,
    from: AbsolutePath,
    kind: EdgeKind,
    aliases: PathAliases | null,
    context: ResolveContext,
  ): string | false | null {
    const mapped =
      aliases === null || inDependency(from) ? [] : aliasCandidates(aliases, specifier);
    for (const candidate of mapped) {
      const found = resolveOne(kind, from, candidate, context);
      if (found !== false) return found;
    }
    return isBuiltin(specifier) ? null : resolveOne(kind, from, specifier, context);
  }

  /**
   * The file Node loads for `specifier`, or `false`. Row 018-66: the path
   * without the `?query#hash` enhanced-resolve appends; with
   * `useSyncFileSystemCalls` it calls back before `resolve` returns.
   */
  function resolveOne(
    kind: EdgeKind,
    from: AbsolutePath,
    specifier: string,
    context: ResolveContext,
  ): string | false {
    let found: string | false = false;
    resolverFor(kind).resolve({}, from, specifier, context, (error, _result, request) => {
      found = error || !request?.path ? false : request.path;
    });
    return found;
  }

  function pairOf(specifier: string, path: AbsolutePath | null) {
    if (!tsx || path === null) return null;
    const asked = extname(specifier);
    const got = extname(path);
    if (TSX_ALIAS[asked] === undefined || got === asked) return null;
    const twin = path.slice(0, -got.length) + asked;
    return exists(twin) ? ([twin, path] as const) : null;
  }
}
