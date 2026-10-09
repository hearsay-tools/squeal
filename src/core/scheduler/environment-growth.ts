import type { KeyChange } from "../keys/index.js";
import type { ProjectName, RelativePath, RunReport } from "../types/index.js";
import { NOTHING_CHANGED, type SchedulerContext, tryRunner } from "./context.js";
import type { FileState } from "./files.js";
import { type Ledger, MAX_DISCARDS } from "./ledger.js";
import { listPaths } from "./notes.js";
import { priorityOf } from "./queue.js";
import type { Tier } from "./tiers.js";

/** What a tier's run loaded beyond the environments its keys held (task 003-43). */
export interface EnvironmentGrowth {
  /** Per tier file (`testFileId`) whose run loaded environment files its key lacked: those paths. */
  readonly files: ReadonlyMap<string, readonly RelativePath[]>;
  /** The key changes reading the environments again made. */
  readonly changes: readonly KeyChange[];
}

/**
 * Spec 003 D5 (task 003-43): a node:test preload loads by a computed
 * specifier what only a run shows, and those paths are environment inputs.
 * A tier file whose run loaded one its key lacked holds a result for a key
 * another worktree differing only in that file shares, so `recordTier`
 * stores nothing for it, and the environments are read again here, unless
 * a refinement already did, so it runs again under the key that holds what
 * it loaded. Under the scheduler lock: it re-keys and hashes into the stat
 * cache. `undefined` when the run loaded nothing beyond those keys.
 */
export async function rekeyEnvironments(
  context: SchedulerContext,
  report: RunReport,
  tier: Tier,
): Promise<EnvironmentGrowth | undefined> {
  const { keys } = context;
  const loaded = new Map<ProjectName, readonly RelativePath[]>();
  for (const { project, paths } of report.environmentObserved ?? []) loaded.set(project, paths);
  const files = new Map<string, RelativePath[]>();
  for (const { file, inputs } of tier.files) {
    const keyed = new Set(inputs);
    const beyond = (loaded.get(file.ref.project) ?? []).filter((path) => !keyed.has(path));
    if (beyond.length > 0) files.set(file.id, beyond);
  }
  if (files.size === 0) return undefined;
  const stale = [...loaded].some(([project, paths]) => {
    const held = new Set(keys.environmentFiles(project));
    return paths.some((path) => !held.has(path));
  });
  if (!stale) return { files, changes: [] };
  const environments = await tryRunner(context, "environment", () => context.runner.environment());
  return { files, changes: environments === null ? [] : await keys.setEnvironments(environments) };
}

/**
 * The grown files `recordTier` stored nothing for, once `settle` moved them
 * to the key the environments read again give: each runs again under it,
 * unless another worktree's result there made it current. Counted with
 * `Ledger.discard`'s, since what the run loaded, not an edit, moved the key:
 * at `MAX_DISCARDS` in a row the file is `unknown`, naming the paths, so a
 * preload that loads a new path every run cannot re-run forever (as task
 * 001-134 bounds first observations).
 */
export function rerunGrown(
  ledger: Ledger,
  growth: EnvironmentGrowth,
  files: readonly FileState[],
): void {
  for (const file of files) {
    if (file.key === null || file.resultKey === file.key) continue;
    file.discards += 1;
    if (file.discards >= MAX_DISCARDS) {
      const paths = listPaths(growth.files.get(file.id) ?? []);
      ledger.markUnknown(
        [{ file, key: file.key }],
        `${MAX_DISCARDS} runs in a row loaded environment files their key lacked (${paths})`,
      );
    } else if (file.blocked === null && !ledger.queue.has(file.ref)) {
      ledger.enqueue(file, priorityOf(file, NOTHING_CHANGED));
    }
  }
}
