import { existsSync, realpathSync } from "node:fs";
import { dirname, join, sep } from "node:path";
import { compare } from "../../../core/fs/compare.js";
import type { AbsolutePath, RelativePath } from "../../../core/types/common.js";
import type { InvalidatedPath, RunnerPackages } from "../../../core/types/runner.js";
import { type AffectedPaths, Graph, type TestFileClosure } from "../../js-graph/graph.js";
import type { LoaderChain } from "../../js-graph/loader-chain.js";
import { PackageSet } from "../../js-graph/packages.js";
import { parserReady } from "../../js-graph/parse.js";
import { createResolver } from "../../js-graph/resolver.js";
import {
  compileModuleNameMapper,
  expandRootDir,
  type ModuleNameMapper,
  mappedResolver,
} from "./mapper.js";
import { snapshotPath } from "./snapshots.js";

export type { AffectedPaths } from "../../js-graph/graph.js";
export type { ModuleNameMapper } from "./mapper.js";

export interface JestGraphOptions {
  /** The worktree root; closures hold paths inside it only. */
  readonly root: AbsolutePath;
  /** The project's Jest `rootDir`: `<rootDir>` in the options below, and where setup files resolve from. */
  readonly rootDir: AbsolutePath;
  /** The project's test files, relative to `root`. */
  readonly testFiles: readonly RelativePath[];
  readonly moduleNameMapper?: ModuleNameMapper | undefined;
  readonly setupFiles?: readonly string[] | undefined;
  readonly setupFilesAfterEnv?: readonly string[] | undefined;
  /** Jest's `snapshotResolver`; set, no snapshot path is known before a run. */
  readonly snapshotResolver?: string | null | undefined;
  /**
   * The tsconfig whose `paths` and `baseUrl` map specifiers, relative to `rootDir` when not
   * absolute. When not given, the nearest `tsconfig.spec.json`, `tsconfig.json` or
   * `tsconfig.base.json` from `rootDir` up to `root`.
   */
  readonly tsconfigPath?: string | undefined;
  /** The test environment's export conditions, such as `browser` under jsdom. */
  readonly conditions?: readonly string[] | undefined;
}

/** One test file's static closure, its setup files' closures and its snapshot path included. */
export interface JestClosure extends TestFileClosure {
  /** First-hop packages and builtins of the test file's closure and of the setup files'. */
  readonly packages: RunnerPackages;
  /** Its default snapshot path, also in `paths`; `null` under a custom `snapshotResolver`. */
  readonly snapshot: RelativePath | null;
}

/**
 * The static module graph of one Jest project (spec 028 D3.3), before any run observed it: the
 * shared JS/TS graph under Jest's resolution, `moduleNameMapper` first, with tsconfig `paths`,
 * `.jsx`, workspace links at their real paths, and the setup files in every test file's closure.
 * Every path in and out is relative to the worktree root.
 */
export interface JestGraph {
  /** Throws for a file not listed. */
  closure(testFile: RelativePath): JestClosure;
  /**
   * `direct`: a changed test file, a test file importing a changed path in one hop, or owning a
   * changed snapshot; `transitive`: another holding it in its closure, every test file for a
   * path in a setup file's closure.
   */
  affected(changed: readonly RelativePath[]): AffectedPaths;
  /** A content change re-parses; an add, a delete or a resolution read re-resolves every closure. */
  invalidate(paths: readonly InvalidatedPath[]): void;
  setTestFiles(testFiles: readonly RelativePath[]): void;
  /** Each listed test file whose static closure is incomplete, with the reasons. */
  incompleteClosures(): readonly (readonly [RelativePath, readonly string[]])[];
  /** Problem notes, such as a `moduleNameMapper` pattern that is no regular expression. */
  notes(): readonly string[];
}

/** The tsconfig names tried from `rootDir` up, in the order `resolve.ts`'s ts-node hygiene takes them. */
const TSCONFIGS = ["tsconfig.spec.json", "tsconfig.json", "tsconfig.base.json"] as const;

export async function createJestGraph(options: JestGraphOptions): Promise<JestGraph> {
  await parserReady;
  const root = realpathSync(options.root) as AbsolutePath;
  const rootDir = realpathSync(options.rootDir) as AbsolutePath;
  const mapper = compileModuleNameMapper(options.moduleNameMapper, rootDir);
  const setup = [...(options.setupFiles ?? []), ...(options.setupFilesAfterEnv ?? [])];
  const chain: LoaderChain = {
    rules: "tsx",
    preloads: setup.map((file) => {
      const specifier = expandRootDir(file, rootDir);
      return { specifier, kind: "require", path: /^[./]/.test(specifier) };
    }),
    conditions: options.conditions ?? [],
    unrecognized: [],
  };
  const tsconfigPath = options.tsconfigPath ?? nearestTsconfig(rootDir, root);
  const resolver = mappedResolver(
    createResolver(chain, root, { cwd: rootDir, tsconfigPath }),
    mapper,
  );
  const graph = new Graph(root, rootDir, chain, resolver);
  graph.build(options.testFiles);
  let testFiles = [...options.testFiles];
  const snapshotOf = (file: RelativePath) => snapshotPath(file, options.snapshotResolver);
  let owners = snapshotOwners(testFiles, snapshotOf);

  return {
    closure(testFile) {
      if (!testFiles.includes(testFile)) {
        throw new Error(`jest graph: ${testFile} is not a test file of this project`);
      }
      const own = graph.closure(testFile);
      const preloads = graph.preloads();
      const snapshot = snapshotOf(testFile);
      const paths = new Set([...own.paths, ...preloads.paths]);
      if (snapshot !== null) paths.add(snapshot);
      const incomplete = [...preloads.incomplete, ...own.incomplete];
      return {
        testFile,
        paths: [...paths].sort(compare),
        complete: incomplete.length === 0,
        incomplete,
        packages: setupPackages(graph.packages(testFile), graph.environmentPackages()),
        snapshot,
      };
    },
    affected(changed) {
      const found = graph.affected(changed);
      const direct = new Set(found.direct);
      for (const path of changed) {
        const owner = owners.get(path);
        if (owner !== undefined) direct.add(owner);
      }
      return {
        direct: [...direct].sort(),
        transitive: found.transitive.filter((file) => !direct.has(file)),
      };
    },
    invalidate: (paths) => graph.invalidate(paths),
    setTestFiles(files) {
      testFiles = [...files];
      owners = snapshotOwners(testFiles, snapshotOf);
      graph.setTestFiles(files);
    },
    incompleteClosures: () => graph.incompleteClosures(),
    notes: () => mapper.notes,
  };
}

/** Each default snapshot path's test file. */
function snapshotOwners(
  testFiles: readonly RelativePath[],
  snapshotOf: (file: RelativePath) => RelativePath | null,
): Map<RelativePath, RelativePath> {
  const owners = new Map<RelativePath, RelativePath>();
  for (const file of testFiles) {
    const snapshot = snapshotOf(file);
    if (snapshot !== null) owners.set(snapshot, file);
  }
  return owners;
}

/**
 * A test file's packages with its setup files' packages, bare setup files among them. The
 * shared graph names tsx as the runner under tsx's rules; Jest loads no tsx, so it is left out.
 */
function setupPackages(own: RunnerPackages, setup: RunnerPackages): RunnerPackages {
  const set = new PackageSet();
  const tsx = new Set(
    (setup.runner ?? []).filter((entry) => entry.name === "tsx").map((entry) => entry.from),
  );
  set.add(own.imports, own.builtins);
  set.add(
    setup.imports.filter((entry) => entry.name !== "tsx" || !tsx.has(entry.from)),
    setup.builtins,
  );
  return set.packages();
}

/** The nearest of {@link TSCONFIGS} from `dir` up to `root`, or `undefined`. */
function nearestTsconfig(dir: AbsolutePath, root: AbsolutePath): string | undefined {
  if (dir !== root && !dir.startsWith(root + sep)) return undefined;
  for (let at = dir; ; at = dirname(at) as AbsolutePath) {
    for (const name of TSCONFIGS) {
      const path = join(at, name);
      if (existsSync(path)) return path;
    }
    if (at === root) return undefined;
  }
}
