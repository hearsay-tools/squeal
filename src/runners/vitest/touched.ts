import { basename } from "node:path";
import type { Vitest } from "vitest/node";
import type { AbsolutePath, RelativePath } from "../../core/types/index.js";
import type { WorktreePaths } from "./paths.js";
import { recreateTriggers } from "./project.js";
import { type Environment, environments, sourceOf } from "./sources.js";

/*
 * Task 013-02 (013 V5 Touched files as amended 2026-10-20, design 013-01
 * sections 2 and 6): a touch counts for an instance only when the instance
 * could have read the path. Every cache but the dependency optimizer, off
 * since task 001-176, records its read in the module graph of the
 * environment that cached it, so a path no module names and no input read
 * once holds is in no cache of the instance.
 */

type Node = NonNullable<ReturnType<Environment["moduleGraph"]["getModuleById"]>>;

/** Read once when an instance starts, by name: the resolver's and the transform's, and `loadEnv`'s (D3 of 013-01). */
const READ_BY_NAME = /^(package\.json|[tj]sconfig.*\.json|\.env.*)$/;

/**
 * Each environment's modules by the project file they name: in Vite's file
 * index, or by their ID with any `\0` and query set aside. An `@import`ed
 * stylesheet has no ID, and a `\0` ID is in no file index, so it takes both.
 */
export class ModuleIndex {
  readonly #byEnvironment = new Map<Environment, Map<string, Set<Node>>>();

  constructor(vitest: Vitest, paths: WorktreePaths) {
    for (const environment of environments(vitest)) {
      const index = new Map<string, Set<Node>>();
      const add = (file: string, node: Node) => {
        const nodes = index.get(file) ?? new Set<Node>();
        index.set(file, nodes.add(node));
      };
      const graph = environment.moduleGraph;
      for (const [file, nodes] of graph.fileToModulesMap) for (const node of nodes) add(file, node);
      for (const [id, node] of graph.idToModuleMap) {
        const file = sourceOf(id, paths);
        if (file !== null) add(file, node);
      }
      this.#byEnvironment.set(environment, index);
    }
  }

  /** True when a module of some environment names `file`. */
  names(file: AbsolutePath): boolean {
    return [...this.#byEnvironment.values()].some((index) => index.has(file));
  }

  /** The modules of `environment` that name `file`: where a walk to the test files reaching it starts. */
  start(environment: Environment, file: AbsolutePath): readonly Node[] {
    return [...(this.#byEnvironment.get(environment)?.get(file) ?? [])];
  }
}

/** Touched paths sorted against one instance; any other was read by none of its caches. */
export interface Sorted {
  /** Inputs the instance read once and holds outside any module graph: every file of a run. */
  readonly inputs: readonly AbsolutePath[];
  /** Paths a module of some environment names: the files that reach one. */
  readonly modules: readonly AbsolutePath[];
  readonly index: ModuleIndex | null;
}

const NONE: Sorted = { inputs: [], modules: [], index: null };

/**
 * Sorts `touched` for `vitest`. An input read once is a config file or one
 * of its dependencies or a file of a global setup's closure (with its
 * missing candidates, `recreateTriggers`), one of `lockfiles`, the installed
 * lockfiles it started with, or a `package.json`, `tsconfig*.json`,
 * `jsconfig*.json` or `.env*` file under the root. A browser-mode project's
 * client environment can still bundle (V5), so there every touch is one.
 */
export async function sortTouched(
  vitest: Vitest,
  touched: readonly AbsolutePath[],
  lockfiles: ReadonlySet<AbsolutePath>,
  paths: WorktreePaths,
): Promise<Sorted> {
  if (touched.length === 0) return NONE;
  if (vitest.projects.some((project) => project.isBrowserEnabled())) {
    return { ...NONE, inputs: [...touched] };
  }
  const once = new Set([...(await recreateTriggers(vitest)), ...lockfiles]);
  const byName = (file: AbsolutePath) =>
    paths.toRelative(file) !== null && READ_BY_NAME.test(basename(file));
  const index = new ModuleIndex(vitest, paths);
  const inputs: AbsolutePath[] = [];
  const modules: AbsolutePath[] = [];
  for (const file of touched) {
    if (once.has(file) || byName(file)) inputs.push(file);
    else if (index.names(file)) modules.push(file);
  }
  return { inputs, modules, index };
}

/** A touch heard and not yet forgotten. */
interface Heard {
  readonly path: RelativePath;
  /** Its place among every touch heard, for `since`. */
  readonly serial: number;
  /** Calls entered before it was heard: those of them still in flight read before it. */
  readonly calls: number;
}

/**
 * The touches heard since the current instance began to start, and the
 * calls of either lane in flight. A touch that does not count is forgotten
 * only once every call in flight when it was heard has returned: a
 * transform records the files it read only when it completes, and
 * transforms run only inside calls (V7).
 */
export class Touches {
  #heard: Heard[] = [];
  #serial = 0;
  #calls = 0;
  readonly #inFlight = new Set<number>();

  hear(paths: readonly RelativePath[]): void {
    for (const path of paths)
      this.#heard.push({ path, serial: this.#serial++, calls: this.#calls });
  }

  /** Runs `fn` as one call in flight. */
  async call<T>(fn: () => Promise<T>): Promise<T> {
    const id = this.#calls++;
    this.#inFlight.add(id);
    try {
      return await fn();
    } finally {
      this.#inFlight.delete(id);
    }
  }

  /** Where an instance begins to start: `since` keeps only what is heard from here on. */
  mark(): number {
    return this.#serial;
  }

  /** An instance that began to start at `mark` read the disk after every touch heard before it. */
  since(mark: number): void {
    this.#heard = this.#heard.filter((touch) => touch.serial >= mark);
  }

  /** Each path heard and not forgotten, once, sorted. */
  pending(): RelativePath[] {
    return [...new Set(this.#heard.map((touch) => touch.path))].sort();
  }

  /** Forgets each touch of `paths` heard after every call still in flight entered. */
  forget(paths: ReadonlySet<RelativePath>): void {
    if (paths.size === 0) return;
    const oldest = Math.min(...this.#inFlight);
    this.#heard = this.#heard.filter((touch) => !paths.has(touch.path) || touch.calls > oldest);
  }
}
