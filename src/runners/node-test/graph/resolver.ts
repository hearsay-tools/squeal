import * as fs from "node:fs";
import { isBuiltin } from "node:module";
import { dirname, extname, join, sep } from "node:path";
import enhanced from "enhanced-resolve";
import type { AbsolutePath } from "../../../core/types/index.js";
import type { LoaderChain } from "./loader-chain.js";
import { parseJsonc, readTsconfigPaths, type TsconfigPaths } from "./tsconfig.js";

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

const BUILTIN: Resolution = { path: null, builtin: true, reads: [], candidates: [], pair: null };

/**
 * One enhanced-resolve resolver per `(tsconfig, import|require)`, configured
 * from the project's loader chain (spec 003 D3), over one
 * `CachedInputFileSystem`. The tsconfig of an importer is found by upward
 * lookup, stopping at the worktree root; Node's own rules ignore it.
 */
export function createResolver(chain: LoaderChain, root: AbsolutePath): Resolver {
  let fileSystem = new enhanced.CachedInputFileSystem(fs, Number.POSITIVE_INFINITY);
  let resolvers = new Map<string, ReturnType<typeof enhanced.ResolverFactory.createResolver>>();
  let tsconfigs = new Map<string, AbsolutePath | null>();
  let realpaths = new Map<string, AbsolutePath | null>();
  let resolutions = new Map<string, Resolution>();
  let tsconfigPaths = new Map<AbsolutePath, TsconfigPaths>();
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
  const chainOf = (tsconfig: AbsolutePath) => {
    let found = tsconfigPaths.get(tsconfig);
    if (found === undefined) {
      found = readTsconfigPaths(tsconfig, readText);
      tsconfigPaths.set(tsconfig, found);
    }
    return found;
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
  /**
   * S1: enhanced-resolve reads inherited `paths` relative to the config it
   * was given, so it is given the config that defines them and the chain's
   * effective `baseUrl` explicitly; a chain with neither needs no tsconfig.
   */
  const tsconfigOption = (paths: TsconfigPaths | null) => {
    if (paths === null || (paths.pathsFile === null && paths.baseUrl === null)) return {};
    const configFile = paths.pathsFile ?? paths.files[0];
    return {
      tsconfig: { configFile, ...(paths.baseUrl === null ? {} : { baseUrl: paths.baseUrl }) },
    };
  };
  const resolverFor = (paths: TsconfigPaths | null, kind: EdgeKind) => {
    const option = tsconfigOption(paths);
    const key = `${JSON.stringify(option)}\0${kind}`;
    let resolver = resolvers.get(key);
    if (resolver === undefined) {
      resolver = enhanced.ResolverFactory.createResolver({
        fileSystem,
        useSyncFileSystemCalls: true,
        conditionNames: ["node", kind, ...chain.conditions],
        symlinks: true,
        ...(tsx
          ? {
              extensions: TSX_EXTENSIONS,
              extensionAlias: TSX_ALIAS,
              ...option,
            }
          : kind === "import"
            ? { extensions: [], fullySpecified: true }
            : { extensions: NODE_REQUIRE_EXTENSIONS }),
      });
      resolvers.set(key, resolver);
    }
    return resolver;
  };
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
      if (isBuiltin(specifier)) return BUILTIN;
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
    const tsconfig = tsx ? tsconfigFor(from) : null;
    const paths = tsconfig === null ? null : chainOf(tsconfig);
    const resolver = resolverFor(paths, kind);
    const context = {
      fileDependencies: new Set<string>(),
      missingDependencies: new Set<string>(),
      contextDependencies: new Set<string>(),
    };
    let target: string | false;
    try {
      target = resolver.resolveSync({}, from, specifier, context);
    } catch {
      target = false;
    }
    // `symlinks: true` already gives the target's real path.
    const path = target === false ? null : target;
    const reads = new Set<AbsolutePath>((paths?.files ?? []).filter(inWorktree));
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
    return { path, builtin: false, reads: [...reads], candidates, pair: pairOf(specifier, path) };
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
