import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import type { Vitest } from "vitest/node";
import { isMissing, mapConcurrent } from "../../core/fs/index.js";
import { isRacy, sameStat } from "../../core/hash/index.js";
import type {
  AbsolutePath,
  EpochMs,
  FileStat,
  RunReport,
  TestFileRef,
} from "../../core/types/index.js";
import type { WorktreePaths } from "./paths.js";
import { refKey } from "./results.js";
import { cachedTransform } from "./stale.js";

/** What was on disk when Vite read one project file: the stat taken before the read, and the bytes' hash. */
interface Stamp {
  readonly stat: FileStat;
  readonly hash: string;
  /** When the bytes were hashed: a stat this close to it may hide a same-size rewrite. */
  readonly hashedAt: EpochMs;
  /** When Vite read the file; a later check keeps it. */
  readonly loadedAt: EpochMs;
}

/**
 * Task 001-146: a cached transform holds the bytes on disk when Vite read
 * them, while a check key names the bytes the watcher hashed. A revert and
 * its restore inside one watcher batch leave the hash as it was, so no
 * revision names the file and nothing invalidates a transform read in
 * between: every later run executed the reverted bytes under a key naming
 * the restored ones.
 *
 * One per Vitest instance. `attach` stamps each project file a Vite server
 * of the instance reads; `stale` names the cached files whose bytes on disk
 * are no longer the ones read, comparing stats as the stat cache does (D3)
 * and hashing only when the stat moved or is racy. A file loaded some other
 * way (Vitest's `fsModuleCache`) has no stamp and is not checked.
 */
export class SourceStamps {
  readonly #stamps = new Map<AbsolutePath, Stamp>();
  /** The plugin containers whose `load` stamps. */
  readonly #attached = new WeakSet<object>();
  /** Files cached by a container before it was attached: what it read is not known. */
  readonly #unknown = new Set<AbsolutePath>();

  constructor(
    private readonly paths: WorktreePaths,
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
   * cached before is stale.
   */
  attach(vitest: Vitest): void {
    for (const environment of environments(vitest)) {
      const container = environment.pluginContainer;
      if (this.#attached.has(container)) continue;
      this.#attached.add(container);
      for (const file of cachedFiles(environment)) this.#unknown.add(file);
      const load = container.load.bind(container);
      container.load = async (id) => {
        await this.#stamp(id);
        return load(id);
      };
    }
  }

  async #stamp(id: string): Promise<void> {
    const file = id as AbsolutePath;
    if (id.includes("?") || id.startsWith("\0") || !this.paths.isProjectFile(file)) return;
    const loadedAt = this.now();
    const read = await this.#read(file);
    this.#unknown.delete(file);
    if (read === null) this.#stamps.delete(file);
    else this.#stamps.set(file, { ...read, hashedAt: loadedAt, loadedAt });
  }

  /**
   * The cached files, among those Vite read at or after `loadedSince`, whose
   * bytes on disk differ from the ones read, or which are gone. A file whose
   * bytes are unchanged takes its new stat, so a touch is hashed once. A
   * file cached before its server was attached is stale until Vite reads it
   * again.
   */
  async stale(vitest: Vitest, loadedSince: EpochMs = 0): Promise<AbsolutePath[]> {
    this.attach(vitest);
    const cached = transformedFiles(vitest);
    const files = [...cached].filter(
      (file) => this.#unknown.has(file) || (this.#stamps.get(file)?.loadedAt ?? -1) >= loadedSince,
    );
    const moved = await mapConcurrent(files, async (file) => {
      if (this.#unknown.has(file)) return true;
      const stamp = this.#stamps.get(file);
      if (!stamp) return false;
      const stat = await statOrNull(file);
      if (stat && sameStat(stat, stamp.stat) && !isRacy(stamp.stat, stamp.hashedAt)) return false;
      const hashedAt = this.now();
      const read = await this.#read(file);
      if (read === null || read.hash !== stamp.hash) return true;
      this.#stamps.set(file, { ...read, hashedAt, loadedAt: stamp.loadedAt });
      return false;
    });
    return files.filter((_, i) => moved[i]).sort();
  }

  /** The stat, then the bytes' hash; `null` when the file is gone. */
  async #read(file: AbsolutePath): Promise<{ stat: FileStat; hash: string } | null> {
    const stat = await statOrNull(file);
    if (stat === null) return null;
    try {
      return {
        stat,
        hash: createHash("sha1")
          .update(await readFile(file))
          .digest("hex"),
      };
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
  }
}

/** Invalidates the stale files of `stamps` in `vitest`; returns them. */
export async function invalidateStale(
  vitest: Vitest,
  stamps: SourceStamps,
  loadedSince?: EpochMs,
): Promise<AbsolutePath[]> {
  const stale = await stamps.stale(vitest, loadedSince);
  for (const file of stale) vitest.invalidateFile(file);
  return stale;
}

/**
 * The run's test files that may have executed `stale`, files the run read
 * whose bytes moved since: those whose import graph in their project reaches
 * one. A stale file no test file of the run reaches was loaded by a
 * specifier Vite never saw (a computed `import()`), so every file of the run
 * may have executed it.
 */
export function mayHaveRun(
  vitest: Vitest,
  stale: readonly AbsolutePath[],
  testFiles: readonly TestFileRef[],
  paths: WorktreePaths,
): TestFileRef[] {
  const tainted = new Set<string>();
  for (const file of stale) {
    const reached = testFiles.filter((ref) => reaches(vitest, file, ref, paths));
    for (const ref of reached.length > 0 ? reached : testFiles) tainted.add(refKey(ref));
  }
  return testFiles.filter((ref) => tainted.has(refKey(ref)));
}

/** True when `ref`'s module imports `file`, directly or not, in some environment of its project. */
function reaches(
  vitest: Vitest,
  file: AbsolutePath,
  ref: TestFileRef,
  paths: WorktreePaths,
): boolean {
  const target = paths.toAbsolute(ref.path);
  for (const project of vitest.projects.filter((p) => p.name === ref.project)) {
    for (const environment of Object.values(project.vite.environments)) {
      type Node = NonNullable<ReturnType<typeof environment.moduleGraph.getModuleById>>;
      const queue: Node[] = [...(environment.moduleGraph.getModulesByFile(file) ?? [])];
      const seen = new Set<Node>();
      for (let node = queue.pop(); node !== undefined; node = queue.pop()) {
        if (seen.has(node)) continue;
        seen.add(node);
        if (node.file === target) return true;
        queue.push(...node.importers);
      }
    }
  }
  return false;
}

/**
 * `report` without `dropped`: their results, errors, durations and observed
 * inputs go, and `failure` says which files moved, so the scheduler records
 * them `unknown` with that reason (D5) instead of storing what they ran.
 */
export function withoutFiles(
  report: RunReport,
  dropped: readonly TestFileRef[],
  stale: readonly AbsolutePath[],
  paths: WorktreePaths,
): RunReport {
  if (dropped.length === 0) return report;
  const gone = new Set(dropped.map(refKey));
  const kept = (ref: TestFileRef) => !gone.has(refKey(ref));
  const moved = stale.map((file) => paths.toRelative(file) ?? file).join(", ");
  const reason = `vitest adapter: ${moved} changed on disk after this run loaded it; the run may have executed bytes no check key names (task 001-146)`;
  const { fileDurations, observed } = report;
  return {
    ...report,
    completedFiles: report.completedFiles.filter(kept),
    results: report.results.filter((r) =>
      kept({ project: r.check.project, path: r.check.testPath }),
    ),
    fileErrors: report.fileErrors.filter((e) => kept(e.testFile)),
    failure: report.failure === null ? reason : `${report.failure}\n${reason}`,
    ...(fileDurations ? { fileDurations: fileDurations.filter((d) => kept(d.testFile)) } : {}),
    ...(observed ? { observed: observed.filter((o) => kept(o.testFile)) } : {}),
  };
}

type Environment = Vitest["projects"][number]["vite"]["environments"][string];

/** Every environment of every project server, once each. */
function environments(vitest: Vitest): Set<Environment> {
  return new Set(vitest.projects.flatMap((p) => Object.values(p.vite.environments)));
}

/** The files with a cached transform in `environment`. */
function cachedFiles(environment: Environment): AbsolutePath[] {
  const files: AbsolutePath[] = [];
  for (const [file, modules] of environment.moduleGraph.fileToModulesMap) {
    if ([...modules].some((m) => cachedTransform(m) !== null)) files.push(file as AbsolutePath);
  }
  return files;
}

/** Every project file with a cached transform in some environment. */
function transformedFiles(vitest: Vitest): Set<AbsolutePath> {
  return new Set([...environments(vitest)].flatMap(cachedFiles));
}

async function statOrNull(file: AbsolutePath): Promise<FileStat | null> {
  try {
    const s = await lstat(file);
    return { mtimeMs: s.mtimeMs, ctimeMs: s.ctimeMs, size: s.size, inode: s.ino };
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
}
