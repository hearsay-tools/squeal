import type { Hasher } from "../hash/hasher.js";
import type { StatCache } from "../hash/stat-cache.js";
import { listedDirectory } from "../keys/observed.js";
import type { SchedulerContext } from "../scheduler/context.js";
import type { EnvironmentGrowth } from "../scheduler/environment-growth.js";
import type { WorktreeKeys } from "../scheduler/keying.js";
import {
  NOTHING_OBSERVED,
  type ObservedGrowth,
  observedGrowth,
  type TierObservations,
} from "../scheduler/observed.js";
import { changedSince, type Moved, snapshotInputs } from "../scheduler/stability.js";
import type { TierFile } from "../scheduler/tiers.js";
import type { RelativePath } from "../types/common.js";
import type { RunReport } from "../types/runner.js";
import type { KeepSources, RunEvidence } from "./run-evidence.js";

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
 * its keys (`observedGrowth`), and the environment files it loaded that its
 * project's keys lack. No revision, runtime identity, merge hold or editor
 * scratch listing is read (`research/run-evidence.md`, differences 2 to 4).
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
  return { changed: inputs.changed, touched: [...inputs.touched].sort(), observed, held: [] };
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
