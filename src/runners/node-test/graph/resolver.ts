import * as fs from "node:fs";
import { isBuiltin } from "node:module";
import { dirname, extname, join, sep } from "node:path";
import enhanced from "enhanced-resolve";
import type { AbsolutePath } from "../../../core/types/index.js";
import type { LoaderChain } from "./loader-chain.js";

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

export interface Resolver {
  resolve(specifier: string, importer: AbsolutePath, kind: EdgeKind): Resolution;
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
        found = fs.realpathSync(path);
      } catch {
        found = null;
      }
      realpaths.set(path, found);
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
  const resolverFor = (tsconfig: AbsolutePath | null, kind: EdgeKind) => {
    const key = `${tsconfig ?? ""}\0${kind}`;
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
              ...(tsconfig === null ? {} : { tsconfig: { configFile: tsconfig } }),
            }
          : kind === "import"
            ? { extensions: [], fullySpecified: true }
            : { extensions: NODE_REQUIRE_EXTENSIONS }),
      });
      resolvers.set(key, resolver);
    }
    return resolver;
  };
  const inWorktree = (path: string) =>
    path.startsWith(root + sep) && !path.includes(`${sep}node_modules${sep}`);

  return {
    resolve(specifier, importer, kind) {
      if (isBuiltin(specifier)) return BUILTIN;
      const from = dirname(importer);
      const resolver = resolverFor(tsx ? tsconfigFor(from) : null, kind);
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
      const path = target === false ? null : real(target);
      const reads = new Set<AbsolutePath>();
      for (const dependency of context.fileDependencies) {
        if (!dependency.endsWith(".json") || dependency === target) continue;
        const read = real(dependency);
        if (read !== null && read !== path && inWorktree(read)) reads.add(read);
      }
      // A directory probed as a file is not a candidate: no file can appear there.
      const candidates =
        path === null
          ? [...context.missingDependencies].filter((p) => inWorktree(p) && !isDirectory(p))
          : [];
      return { path, builtin: false, reads: [...reads], candidates, pair: pairOf(specifier, path) };
    },
    clear() {
      fileSystem = new enhanced.CachedInputFileSystem(fs, Number.POSITIVE_INFINITY);
      resolvers = new Map();
      tsconfigs = new Map();
      realpaths = new Map();
    },
  };

  function pairOf(specifier: string, path: AbsolutePath | null) {
    if (!tsx || path === null) return null;
    const asked = extname(specifier);
    const got = extname(path);
    if (TSX_ALIAS[asked] === undefined || got === asked) return null;
    const twin = path.slice(0, -got.length) + asked;
    return exists(twin) ? ([twin, path] as const) : null;
  }
}
