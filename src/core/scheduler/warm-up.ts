import { listedDirectory, listingPath, testFileId } from "../keys/index.js";
import type { CheckpointRecord, RelativePath, RunReport } from "../types/index.js";
import { checkIgnored } from "../watcher/git.js";
import type { SchedulerContext } from "./context.js";
import { addIgnoredReads, startIgnoredReads } from "./ignored-reads.js";
import type { Ledger } from "./ledger.js";
import type { Tier } from "./tiers.js";

/** A tier's ignored reads, for the warm-up record `record`. */
export interface WarmUpReads {
  readonly record: string;
  /** By `testFileId`: the gitignored paths the file read beyond its closure, listings as `dir/`. */
  readonly files: ReadonlyMap<string, readonly RelativePath[]>;
}

/**
 * The warm-up in progress (task 001-307; spec 005 D3, open question 6): a
 * `run --all` checkpoint requested with `observeIgnored`. Its tiers run with
 * `RunOptions.observeIgnored`, and of what each completed file read
 * (`RunReport.reads`), the gitignored worktree paths its closure lacks go to
 * the worktree's `ignored-reads` row (`ignored-reads.ts`), which the
 * request replaced. Nothing of it reaches a key, a closure, a result or a
 * revision. A later checkpoint, warm-up or not, ends it: its tiers carry
 * another checkpoint id.
 */
export class WarmUp {
  /** The checkpoint id its tiers carry, and the record id the request returned (they differ when joined). */
  #current: { readonly checkpoint: string; readonly record: string } | null = null;

  /** Under the lock, after `queueFullSuite` returned `record` for a warm-up request. */
  start(context: SchedulerContext, ledger: Ledger, record: CheckpointRecord): void {
    startIgnoredReads(context.store, context.worktreeId, record.id, record.revision);
    const active = ledger.checkpoints.active;
    this.#current =
      record.end === null && active !== null
        ? { checkpoint: active.record.id, record: record.id }
        : null;
  }

  /** Whether `tier` runs for the warm-up, so its runner reports what each file read. */
  observes(tier: Tier): boolean {
    return this.#current !== null && tier.checkpointId === this.#current.checkpoint;
  }

  /** Outside the lock: the tier's ignored reads, or `null` when it is no warm-up's or git failed. */
  async read(
    context: SchedulerContext,
    tier: Tier,
    report: RunReport,
  ): Promise<WarmUpReads | null> {
    const current = this.#current;
    if (current === null || tier.checkpointId !== current.checkpoint) return null;
    const asked = new Set(
      tier.files
        .filter((f) => f.checkpointId === current.checkpoint)
        .map((f) => testFileId(f.file.ref)),
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
    const files = new Map<string, RelativePath[]>();
    for (const { id, paths } of seen) {
      const kept = paths.filter((path) => ignored.has(listedDirectory(path) ?? path));
      if (kept.length > 0) files.set(id, kept);
    }
    return { record: current.record, files };
  }

  /** In the tier's store transaction. */
  record(context: SchedulerContext, reads: WarmUpReads | null): void {
    if (reads === null) return;
    addIgnoredReads(context.store, context.worktreeId, reads.record, reads.files);
  }
}
