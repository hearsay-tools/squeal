import { testFileId } from "../keys/index.js";
import type {
  CheckpointEnd,
  CheckpointKind,
  CheckpointRecord,
  EpochMs,
  RevisionNumber,
  Store,
  TestFileRef,
  WorktreeId,
} from "../types/index.js";

interface Active {
  readonly record: CheckpointRecord;
  readonly remaining: Set<string>;
  /** Only results attributed to this checkpoint count (`run --all --force`). */
  readonly strict: boolean;
  failed: boolean;
}

/**
 * The open checkpoint of a worktree: one baseline or `run --all` request.
 *
 * Spec 001 D7: "A checkpoint is one `run --all` or baseline request; its tiers
 * are separate runs that reference it." It completes when every requested test
 * file got a result, from a run or a lookup, at any key. It is abandoned when a
 * tier crashed or timed out on one of its files, when a newer request replaces
 * it, or when the daemon stops first. A forced `run --all` is strict: a result
 * counts only from its own tiers, never from a tier already in flight when it
 * was requested.
 */
export class Checkpoints {
  #active: Active | null = null;

  constructor(
    private readonly store: Store,
    private readonly worktreeId: WorktreeId,
    private readonly now: () => EpochMs,
  ) {}

  get active(): { readonly record: CheckpointRecord; readonly remaining: number } | null {
    const active = this.#active;
    return active === null ? null : { record: active.record, remaining: active.remaining.size };
  }

  /** Id of the open checkpoint when it requested `ref`, else `null`. */
  idFor(ref: TestFileRef): string | null {
    const active = this.#active;
    return active?.remaining.has(testFileId(ref)) ? active.record.id : null;
  }

  /** Records a new checkpoint, abandoning the open one. With no files it completes at once. */
  start(
    id: string,
    kind: CheckpointKind,
    revision: RevisionNumber,
    testFiles: readonly TestFileRef[],
    strict = false,
  ): CheckpointRecord {
    this.finish("abandoned");
    const record = this.store.checkpoints.start({
      id,
      worktreeId: this.worktreeId,
      revision,
      kind,
      testFiles,
      startedAt: this.now(),
    });
    this.#active = { record, remaining: new Set(testFiles.map(testFileId)), strict, failed: false };
    this.#settle();
    return record;
  }

  /** `ref` got a result, attributed to checkpoint `by` (`StateProvenance.checkpointId`). */
  done(ref: TestFileRef, by: string | null): void {
    const active = this.#active;
    if (active === null || (active.strict && by !== active.record.id)) return;
    active.remaining.delete(testFileId(ref));
    this.#settle();
  }

  /** `ref` crashed or timed out: the checkpoint cannot complete. */
  failed(ref: TestFileRef): void {
    const active = this.#active;
    if (!active?.remaining.delete(testFileId(ref))) return;
    active.failed = true;
    this.#settle();
  }

  /** Ends the open checkpoint, if any. */
  finish(end: CheckpointEnd): void {
    const active = this.#active;
    if (active === null) return;
    this.#active = null;
    this.store.checkpoints.finish(active.record.id, end, this.now());
  }

  #settle(): void {
    const active = this.#active;
    if (active !== null && active.remaining.size === 0) {
      this.finish(active.failed ? "abandoned" : "completed");
    }
  }
}
