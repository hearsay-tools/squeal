import type { Vitest } from "vitest/node";
import { mapConcurrent } from "../../core/fs/index.js";
import { isRacy, sameStat } from "../../core/hash/index.js";
import type { AbsolutePath, EpochMs, FileStat } from "../../core/types/index.js";
import type { WorktreePaths } from "./paths.js";
import { cachedTransform } from "./stale.js";
import { changedBefore, readStamp, statOrNull } from "./stamp.js";

/** What was on disk when Vite read one project file: the stat taken before the read, and the bytes' hash. */
interface Stamp {
  /** The project file the module ID names, its query and any `\0` aside. */
  readonly file: AbsolutePath;
  readonly stat: FileStat;
  readonly hash: string;
  /** When the bytes were hashed: a stat this close to it may hide a same-size rewrite. */
  readonly hashedAt: EpochMs;
  /** When Vite read the file; a later check keeps it. */
  readonly loadedAt: EpochMs;
}

/** The bytes on disk and when they were hashed. */
interface Hashed {
  readonly stat: FileStat;
  readonly hash: string;
  readonly hashedAt: EpochMs;
}

/** One plugin container's reads. */
interface Reads {
  /**
   * Per module ID of a project file. Review wave-13c B1: query variants of
   * one file (`mod.ts?variant`, `mod.ts?raw`) are cached as modules of their
   * own, each from its own read, so each keeps its own stamp.
   */
  readonly stamps: Map<string, Stamp>;
  /**
   * Per virtual module ID (one that names no project file): when its load
   * began, and a stamp of each project file its plugin read and declared
   * (`addWatchFile`, a module node without a transform among its imports).
   */
  readonly virtual: Map<
    string,
    { readonly loadedAt: EpochMs; readonly inputs: Map<string, Stamp> }
  >;
}

/**
 * Task 001-146: a cached transform holds the bytes on disk when Vite read
 * them, while a check key names the bytes the watcher hashed. A revert and
 * its restore inside one watcher batch leave the hash as it was, so no
 * revision names the file and nothing invalidates a transform read in
 * between: every later run executed the reverted bytes under a key naming
 * the restored ones.
 *
 * One per Vitest instance. `attach` stamps each module of a project file a
 * Vite server of the instance loads; `stale` names the project files with a
 * cached module whose bytes on disk are no longer the ones read, comparing
 * stats as the stat cache does (D3) and hashing only when the stat moved or
 * is racy. A cached module of a project file with no stamp was not loaded
 * through a stamped container (cached before `attach`, or by Vitest's
 * `fsModuleCache`): what it holds is not known, so it is stale. A virtual
 * module's declared inputs are stamped at the first check after its load,
 * if they changed before it began; one changed since is stale.
 */
export class SourceStamps {
  /**
   * Review wave-13b B2: per plugin container, what it read. Two servers (two
   * projects with config files of their own) cache the same file each from
   * its own read, so one stamp per path let the second read hide the first:
   * each transform is checked against its own container's stamp.
   */
  readonly #containers = new WeakMap<object, Reads>();
  /**
   * Task 001-150: what `stale` found moved since the last run's check, and
   * when Vite had read it. The runner part checks during a run, and the
   * caller invalidates what it finds, so the run's own check after it ends
   * no longer sees those transforms; it reads them here.
   */
  #moved: { readonly file: AbsolutePath; readonly loadedAt: EpochMs }[] = [];

  constructor(
    readonly paths: WorktreePaths,
    private readonly now: () => EpochMs = Date.now,
  ) {}

  /**
   * Review wave-13 B2: a plugin passed to `createVitest` reaches the root
   * server and the inline projects sharing it, not a project with its own
   * config file, which gets a Vite server of its own. So the stamp goes into
   * the plugin container of every environment of every project server: its
   * `load` stamps the file, then loads it as before. The stat comes before
   * this read and this read before Vite's, so a write after the stat moves
   * the stat, and the check sees it. Idempotent; `stale` attaches first, so
   * a project server added later is stamped from its next load, and what it
   * cached before has no stamp, so it is stale.
   */
  attach(vitest: Vitest): void {
    for (const environment of environments(vitest)) {
      const container = environment.pluginContainer;
      if (this.#containers.has(container)) continue;
      const reads: Reads = { stamps: new Map(), virtual: new Map() };
      this.#containers.set(container, reads);
      const load = container.load.bind(container);
      container.load = async (id) => {
        await this.#stamp(reads, id);
        return load(id);
      };
    }
  }

  async #stamp(reads: Reads, id: string): Promise<void> {
    const file = sourceOf(id, this.paths);
    const loadedAt = this.now();
    if (file === null) {
      reads.virtual.set(id, { loadedAt, inputs: new Map() });
      return;
    }
    const read = await readStamp(file);
    if (read === null) reads.stamps.delete(id);
    else reads.stamps.set(id, { file, ...read, hashedAt: loadedAt, loadedAt });
  }

  /**
   * The project files with a cached module, among those Vite read at or
   * after `loadedSince`, whose bytes on disk differ from the ones read, or
   * which are gone. Each cached module, query variants included, is checked
   * against what its own container read for that module ID, and a file
   * stale in one is named once, for every project and variant. A file whose
   * bytes are unchanged takes its new stat, so a touch is hashed once. A
   * cached module with no stamp is stale, whenever it was read.
   *
   * With `loadedSince`, a run's check after it ends: it also names what an
   * earlier call found moved since that run began loading (task 001-150),
   * and starts the log again.
   */
  async stale(vitest: Vitest, loadedSince?: EpochMs): Promise<AbsolutePath[]> {
    this.attach(vitest);
    const since = loadedSince ?? 0;
    const unknownAt = Number.POSITIVE_INFINITY as EpochMs;
    // `stamps.get(key)` is what was read of `file`; without one, a stamp is
    // taken now if `file` changed before `after`, else the read is unknown.
    const checks: {
      readonly stamps: Map<string, Stamp>;
      readonly key: string;
      readonly file: AbsolutePath;
      readonly after?: EpochMs | undefined;
    }[] = [];
    for (const environment of environments(vitest)) {
      const reads = this.#containers.get(environment.pluginContainer);
      if (!reads) continue;
      for (const [id, file] of cachedModules(environment, this.paths)) {
        const stamps = reads.stamps;
        if ((stamps.get(id)?.loadedAt ?? unknownAt) >= since)
          checks.push({ stamps, key: id, file });
      }
      for (const [id, files] of virtualInputs(environment, this.paths)) {
        const load = reads.virtual.get(id);
        if ((load?.loadedAt ?? unknownAt) < since) continue;
        for (const file of files) {
          checks.push({
            stamps: load?.inputs ?? new Map(),
            key: file,
            file,
            after: load?.loadedAt,
          });
        }
      }
    }
    // One stat and at most one hash per file, however many modules read it.
    const stats = new Map<AbsolutePath, Promise<FileStat | null>>();
    const hashes = new Map<AbsolutePath, Promise<Hashed | null>>();
    const statOnce = (file: AbsolutePath) => memo(stats, file, () => statOrNull(file));
    const hashOnce = (file: AbsolutePath) =>
      memo(hashes, file, async () => {
        const hashedAt = this.now();
        const read = await readStamp(file);
        return read && { ...read, hashedAt };
      });
    const moved = await mapConcurrent(checks, async ({ stamps, key, file, after }) => {
      const stamp = stamps.get(key);
      const stat = await statOnce(file);
      if (!stamp) {
        if (after === undefined || stat === null || !changedBefore(stat, after))
          return after ?? unknownAt;
        const read = await hashOnce(file);
        if (read === null) return after;
        stamps.set(key, { file, ...read, loadedAt: after });
        return null;
      }
      if (stat && sameStat(stat, stamp.stat) && !isRacy(stamp.stat, stamp.hashedAt)) return null;
      const read = await hashOnce(file);
      if (read === null || read.hash !== stamp.hash) return stamp.loadedAt;
      // A load meanwhile (a run in flight) stamped what it read; that stamp stays.
      if (stamps.get(key) === stamp)
        stamps.set(key, { ...stamp, ...read, loadedAt: stamp.loadedAt });
      return null;
    });
    const found = new Set<AbsolutePath>();
    checks.forEach(({ file }, i) => {
      const loadedAt = moved[i];
      if (loadedAt === null || loadedAt === undefined) return;
      found.add(file);
      this.#moved.push({ file, loadedAt });
    });
    if (loadedSince !== undefined) {
      for (const m of this.#moved) if (m.loadedAt >= loadedSince) found.add(m.file);
      this.#moved = [];
    }
    return [...found].sort();
  }
}

/**
 * Invalidates the stale files of `stamps` in `vitest`, every module that
 * names one included (a `\0` ID is not among its file's modules); returns
 * them.
 */
export async function invalidateStale(
  vitest: Vitest,
  stamps: SourceStamps,
  loadedSince?: EpochMs,
): Promise<AbsolutePath[]> {
  const stale = await stamps.stale(vitest, loadedSince);
  if (stale.length === 0) return stale;
  for (const file of stale) vitest.invalidateFile(file);
  const files = new Set<AbsolutePath>(stale);
  for (const environment of environments(vitest)) {
    const graph = environment.moduleGraph;
    for (const [id, file] of cachedModules(environment, stamps.paths)) {
      const module = graph.getModuleById(id);
      if (files.has(file) && module) graph.invalidateModule(module);
    }
    for (const [id, inputs] of virtualInputs(environment, stamps.paths)) {
      const module = graph.getModuleById(id);
      if (inputs.some((file) => files.has(file)) && module) graph.invalidateModule(module);
    }
  }
  return stale;
}

type Environment = Vitest["projects"][number]["vite"]["environments"][string];

/** Every environment of every project server, once each. */
function environments(vitest: Vitest): Set<Environment> {
  return new Set(vitest.projects.flatMap((p) => Object.values(p.vite.environments)));
}

/** Each module ID with a cached transform in `environment` that names a project file, and that file. */
function cachedModules(environment: Environment, paths: WorktreePaths): Map<string, AbsolutePath> {
  const modules = new Map<string, AbsolutePath>();
  for (const [id, module] of environment.moduleGraph.idToModuleMap) {
    const file = cachedTransform(module) === null ? null : sourceOf(id, paths);
    if (file !== null) modules.set(id, file);
  }
  return modules;
}

/**
 * Each cached virtual module of `environment` (its ID names no project file)
 * and the project files it declared it read: its imports without a
 * transform of their own.
 */
function virtualInputs(
  environment: Environment,
  paths: WorktreePaths,
): Map<string, AbsolutePath[]> {
  const found = new Map<string, AbsolutePath[]>();
  for (const [id, module] of environment.moduleGraph.idToModuleMap) {
    if (cachedTransform(module) === null || sourceOf(id, paths) !== null) continue;
    const inputs: AbsolutePath[] = [];
    for (const imported of module.importedModules) {
      const file = cachedTransform(imported) === null ? sourceOf(imported.id ?? "", paths) : null;
      if (file !== null) inputs.push(file);
    }
    if (inputs.length > 0) found.set(id, inputs);
  }
  return found;
}

/**
 * The project file a module ID names: without its query or hash, as Vite's
 * `cleanUrl`, and without the `\0` a plugin marks a virtual ID with. `null`
 * when it names none.
 */
function sourceOf(id: string, paths: WorktreePaths): AbsolutePath | null {
  const file = id.replace(/^\0/, "").replace(/[?#].*$/s, "") as AbsolutePath;
  return file.startsWith("/") && paths.isProjectFile(file) ? file : null;
}

function memo<K, V>(cache: Map<K, Promise<V>>, key: K, compute: () => Promise<V>): Promise<V> {
  let value = cache.get(key);
  if (value === undefined) {
    value = compute();
    cache.set(key, value);
  }
  return value;
}
