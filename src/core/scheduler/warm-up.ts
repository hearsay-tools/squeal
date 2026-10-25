import { listedDirectory, listingPath, testFileId } from "../keys/index.js";
import type { CheckpointRecord, RelativePath, RunReport } from "../types/index.js";
import { checkIgnored } from "../watcher/git.js";
import type { SchedulerContext } from "./context.js";
import { addIgnoredReads, startIgnoredReads } from "./ignored-reads.js";
import type { Ledger } from "./ledger.js";
import { scratchOf } from "./observed.js";
import type { Tier } from "./tiers.js";

/** A tier's ignored reads, for the warm-up record `record`. */
export interface WarmUpReads {
  readonly record: string;
  /**
   * By `testFileId`, each file the runner observed: the gitignored paths it
   * read beyond its closure and beyond what the record keys (016 D4),
   * listings as `dir/`; none when it read none.
   */
  readonly files: ReadonlyMap<string, readonly RelativePath[]>;
}

/**
 * The warm-up in progress (task 001-307; spec 005 D3, open question 6): a
 * `run --all` checkpoint requested with `observeIgnored`. It never joins and
 * runs every file forced (`queueFullSuite`), so only its own tiers count for
 * it, and they run with `RunOptions.observeIgnored` (review wave 13ar, B1).
 * Of what each completed file read (`RunReport.reads`), the gitignored
 * worktree paths its closure lacks and its record does not key (016 D4,
 * the written-directory bound) go to the worktree's `ignored-reads` row
 * (`ignored-reads.ts`), which the request replaced: every file the runner
 * observed has an entry, empty when it read none, and a file it could not
 * observe has none. Nothing of it reaches a key, a closure, a result or a
 * revision. A later checkpoint, warm-up or not, ends it: its tiers carry
 * another checkpoint id.
 */
export class WarmUp {
  /** The warm-up's checkpoint id, which its tiers carry. */
  #current: string | null = null;

  /** Under the lock, after `queueFullSuite` returned `record` for a warm-up request. */
  start(context: SchedulerContext, ledger: Ledger, record: CheckpointRecord): void {
    startIgnoredReads(context.store, context.worktreeId, record.id, record.revision);
    const open = ledger.checkpoints.active?.record.id === record.id;
    this.#current = open ? record.id : null;
  }

  /** Whether `tier` runs for the warm-up, so its runner reports what each file read. */
  observes(tier: Tier): boolean {
    return this.#current !== null && tier.checkpointId === this.#current;
  }

  /** Outside the lock: the tier's ignored reads, or `null` when it is no warm-up's or git failed. */
  async read(
    context: SchedulerContext,
    tier: Tier,
    report: RunReport,
  ): Promise<WarmUpReads | null> {
    const current = this.#current;
    if (current === null || tier.checkpointId !== current) return null;
    const asked = new Set(
      tier.files.filter((f) => f.checkpointId === current).map((f) => testFileId(f.file.ref)),
    );
    const seen: { id: string; paths: RelativePath[] }[] = [];
    for (const read of report.reads ?? []) {
      const id = testFileId(read.testFile);
      if (!asked.has(id)) continue;
      const closure = new Set(context.keys.index.closure(read.testFile)?.paths ?? []);
      const paths = [...read.paths, ...read.directories.map(listingPath)];
      seen.push({ id, paths: paths.filter((path) => !closure.has(path)) });
    }
    const candidates = new Set(seen.flatMap((s) => s.paths.map((p) => listedDirectory(p) ?? p)));
    candidates.delete("");
    let ignored: Set<RelativePath>;
    try {
      ignored = await checkIgnored(context.root, [...candidates]);
    } catch {
      // A suggestion only: a git failure costs the tier's list, never its results.
      return null;
    }
    const keyed = keyedByRecord(context, report, ignored);
    const files = new Map<string, RelativePath[]>();
    for (const { id, paths } of seen) {
      const kept = keyed.get(id);
      files.set(
        id,
        paths.filter((path) => ignored.has(listedDirectory(path) ?? path) && !kept?.has(path)),
      );
    }
    return { record: current, files };
  }

  /** In the tier's store transaction. */
  record(context: SchedulerContext, reads: WarmUpReads | null): void {
    if (reads === null) return;
    addIgnoredReads(context.store, context.worktreeId, reads.record, reads.files);
  }
}

/**
 * By `testFileId`, what the record of `report` keys for each file: the paths
 * and listings its runner observed, a project `keys.observes`, that the
 * written-directory bound keeps (016 D4, `observedGrowth`). A git-ignored
 * path among them is keyed from this run on, so the warm-up names none.
 */
function keyedByRecord(
  context: SchedulerContext,
  report: RunReport,
  ignored: ReadonlySet<RelativePath>,
): Map<string, Set<RelativePath>> {
  const out = new Map<string, Set<RelativePath>>();
  for (const observed of report.observed ?? []) {
    if (!context.keys.observes(observed.testFile.project)) continue;
    const scratch = scratchOf(observed.written ?? [], ignored);
    const paths = [...observed.paths, ...observed.directories.map(listingPath)];
    const kept = paths.filter((path) => !scratch(listedDirectory(path) ?? path));
    out.set(testFileId(observed.testFile), new Set(kept));
  }
  return out;
}
