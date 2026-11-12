import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { runGit } from "../fs/git.js";
import type { Hasher } from "../hash/hasher.js";
import type { StatCache } from "../hash/stat-cache.js";
import { listedDirectory } from "../keys/observed.js";
import type { SchedulerContext } from "../scheduler/context.js";
import type { EnvironmentGrowth } from "../scheduler/environment-growth.js";
import { heldFiles, unmergedIndexPaths } from "../scheduler/hold.js";
import type { WorktreeKeys } from "../scheduler/keying.js";
import {
  NOTHING_OBSERVED,
  type ObservedGrowth,
  observedGrowth,
  type TierObservations,
} from "../scheduler/observed.js";
import { changedSince, type Moved, snapshotInputs } from "../scheduler/stability.js";
import type { TierFile } from "../scheduler/tiers.js";
import type { AbsolutePath, RelativePath } from "../types/common.js";
import type { RunReport } from "../types/runner.js";
import type { HeldPaths, KeepSources, RunEvidence } from "./run-evidence.js";
import { listingsAmong, scratchMoves } from "./scratch.js";

/* Where the run evidence is read from (`run-evidence.ts`, which alone imports this file). */

/**
 * The inputs among `paths` whose content differs from `before`, and the
 * touched ones (`changedSince`). A listing is no file: the revisions during
 * the run cover it, and the editor-scratch listings.
 */
export function movedInputs(
  before: StatCache,
  paths: Iterable<RelativePath>,
  hasher: Hasher,
): Promise<Moved> {
  const files = new Set<RelativePath>();
  for (const path of paths) if (listedDirectory(path) === null) files.add(path);
  return changedSince(before, files, hasher);
}

/**
 * `growth`, and which of its file paths changed on disk since the stat
 * cache read them, or were written and ended as they were: the stability
 * check of D5 and the completion barrier (task 001-168) for paths the copy
 * before the run did not hold. A listing is checked against the revisions
 * during the run (`Tier.changes`). Under the scheduler lock, after
 * `prepareObserved` hashed the paths into the stat cache.
 */
export async function observedMoves(
  context: Pick<SchedulerContext, "keys" | "hasher">,
  growth: Map<string, ObservedGrowth>,
): Promise<TierObservations> {
  if (growth.size === 0) return NOTHING_OBSERVED;
  const paths = new Set<RelativePath>();
  for (const { growth: grown } of growth.values()) {
    for (const path of grown) if (listedDirectory(path) === null) paths.add(path);
  }
  const before = snapshotInputs(context.keys.cache, paths);
  return { growth, ...(await changedSince(before, paths, context.hasher)) };
}

/**
 * The keeper's evidence: its inputs that moved, what the run read beyond
 * its keys (`observedGrowth`), the environment files it loaded that its
 * project's keys lack, and since row 011-320 the files a merge holds
 * (difference 3) and the listings an editor scratch file moved
 * (`scratchMoves`, difference 4). No revision is read; the runtime's
 * identity is `keepDecisions`' (difference 2).
 */
export async function readKeepEvidence(
  sources: KeepSources,
  files: readonly TierFile[],
  report: RunReport,
): Promise<RunEvidence> {
  const { root, keys } = sources;
  const growth = await observedGrowth({ root, keys }, report, sources.run);
  const inputs = await movedInputs(
    sources.before,
    files.flatMap((f) => f.inputs),
    sources.hasher,
  );
  const environment = loadedBeyondKeys(keys, files, report);
  const observed: TierObservations = {
    ...NOTHING_OBSERVED,
    growth,
    ...(environment === undefined ? {} : { environment }),
  };
  const held = heldFiles(await sources.hold.read(), files, growth);
  const listings = listingsAmong(files.flatMap((f) => f.inputs));
  const scratch = await scratchMoves(root, sources.scratch, listings);
  const changed = scratch.length === 0 ? inputs.changed : new Set([...inputs.changed, ...scratch]);
  return { changed, touched: [...inputs.touched].sort(), observed, held };
}

/**
 * Row 011-320 (difference 3; 011 C9): `squeal code`'s merge hold, the
 * worktree's unmerged index paths read as `MergeHold` reads them (`git
 * ls-files -u`), and again only when the index file moved since. A read
 * that fails leaves the paths as last read, none before the first, as the
 * daemon's hold does. It writes nothing.
 */
export class UnmergedIndex {
  readonly #root: AbsolutePath;
  #index: Promise<AbsolutePath | null> | null = null;
  /** The index file's stat at the last read that applied; `undefined` before one. */
  #read: string | undefined = undefined;
  #paths: ReadonlySet<RelativePath> = new Set();

  constructor(root: AbsolutePath) {
    this.#root = root;
  }

  async read(): Promise<HeldPaths> {
    const before = await this.#stat();
    if (before !== this.#read) {
      try {
        const out = await runGit(this.#root, ["ls-files", "-u", "-z"]);
        this.#paths = new Set(unmergedIndexPaths(out));
        this.#read = before;
      } catch {
        // As the daemon's hold: the paths stay as last read.
      }
    }
    const paths = this.#paths;
    return {
      holding: paths.size > 0,
      names: (asked) => [...asked].some((path) => paths.has(path)),
    };
  }

  /** The index file's inode, size and mtime; "none" without one. Its path is read once. */
  async #stat(): Promise<string> {
    this.#index ??= runGit(this.#root, ["rev-parse", "--git-path", "index"]).then(
      (out) => resolve(this.#root, out.trim()),
      () => null,
    );
    const index = await this.#index;
    if (index === null) return "none";
    try {
      const { ino, size, mtimeMs } = await stat(index);
      return `${ino} ${size} ${mtimeMs}`;
    } catch {
      return "none";
    }
  }
}

/** The files of `files` whose project's run loaded an environment file its keys lack. */
function loadedBeyondKeys(
  keys: WorktreeKeys,
  files: readonly TierFile[],
  report: RunReport,
): EnvironmentGrowth | undefined {
  const beyond = new Map<string, RelativePath[]>();
  for (const { project, paths } of report.environmentObserved ?? []) {
    const keyed = new Set(keys.environmentFiles(project));
    const lacking = paths.filter((path) => !keyed.has(path));
    if (lacking.length > 0) beyond.set(project, lacking);
  }
  const loaded = new Map<string, readonly RelativePath[]>();
  for (const { file } of files) {
    const paths = beyond.get(file.ref.project);
    if (paths !== undefined) loaded.set(file.id, paths);
  }
  return loaded.size === 0 ? undefined : { files: loaded, changes: [] };
}
