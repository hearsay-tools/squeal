import { testFileId } from "../keys/index.js";
import {
  type CheckpointEnd,
  type CheckpointKind,
  type CheckpointProgress,
  type CheckpointRecord,
  checkpointMetaKey,
  type EpochMs,
  type OwedCheckpoint,
  parseCheckpointProgress,
  type RevisionNumber,
  type Store,
  type TestFileRef,
  type WorktreeId,
} from "../types/index.js";

interface Active {
  /** The checkpoint whose id its results carry (`idFor`). */
  readonly record: CheckpointRecord;
  /** Requests that end with it: a joined `run --all` (001-217), a resumed one (001-219). */
  readonly joined: CheckpointRecord[];
  readonly remaining: Map<string, TestFileRef>;
  /** Files only results attributed to it count for (`run --all --force`). */
  readonly strict: Set<string>;
  /** Files ever requested, for progress. */
  total: number;
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
 *
 * Task 001-217: a `run --all` whose files the open checkpoint already runs
 * joins it (`join`): its record ends with the open one instead of replacing
 * it. Task 001-219: a daemon that stops with an explicit checkpoint open owes
 * it (`owe`), and the next daemon resumes it (`resume`). The open checkpoint
 * and its progress are kept in `meta` for status (`checkpointMetaKey`).
 */
export class Checkpoints {
  #active: Active | null = null;
  /** What `meta` holds, as this tracker last wrote it; `null` before its first write. */
  #published: string | null = null;

  /** What the last daemon left in `meta`, read before this one records anything. */
  #left: CheckpointProgress | null;

  constructor(
    private readonly store: Store,
    private readonly worktreeId: WorktreeId,
    private readonly now: () => EpochMs,
  ) {
    this.#left = parseCheckpointProgress(store.meta.get(checkpointMetaKey(worktreeId)));
  }

  /**
   * Once: the checkpoint the last daemon owed (task 001-219), with its
   * `run --all` records still open; `null` when none is. A checkpoint the
   * last daemon left open without owing it (it was killed) is abandoned.
   */
  takeOwed(): { readonly owed: OwedCheckpoint; readonly records: CheckpointRecord[] } | null {
    const left = this.#left;
    this.#left = null;
    if (left === null) return null;
    const open = (id: string) => {
      const record = this.store.checkpoints.get(id);
      return record !== null && record.end === null ? [record] : [];
    };
    if (left.owed === undefined) {
      for (const record of open(left.id)) {
        this.store.checkpoints.finish(record.id, "abandoned", this.now());
      }
      return null;
    }
    const records = left.owed.ids.flatMap(open);
    return records.length === 0 ? null : { owed: left.owed, records };
  }

  get active(): {
    readonly record: CheckpointRecord;
    readonly remaining: number;
    /** A `run --all` request is among its records. */
    readonly explicit: boolean;
  } | null {
    const active = this.#active;
    if (active === null) return null;
    return { record: active.record, remaining: active.remaining.size, explicit: explicit(active) };
  }

  /** Id of the open checkpoint when it requested `ref`, else `null`. */
  idFor(ref: TestFileRef): string | null {
    const active = this.#active;
    return active?.remaining.has(testFileId(ref)) ? active.record.id : null;
  }

  /**
   * Whether the open checkpoint still runs every one of `refs`; with
   * `strict`, as a forced request needs them run (task 001-217).
   */
  covers(refs: readonly TestFileRef[], strict: boolean): boolean {
    const active = this.#active;
    if (active === null) return false;
    return refs.every((ref) => {
      const id = testFileId(ref);
      return active.remaining.has(id) && (!strict || active.strict.has(id));
    });
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
    const record = this.#insert(id, kind, revision, testFiles);
    this.#active = {
      record,
      joined: [],
      remaining: new Map(),
      strict: new Set(),
      total: 0,
      failed: false,
    };
    this.#add(testFiles, strict ? testFiles : []);
    this.#settle();
    return record;
  }

  /**
   * Records a request whose files the open checkpoint runs (`covers`): it
   * ends when, and as, the open one ends (task 001-217).
   */
  join(
    id: string,
    kind: CheckpointKind,
    revision: RevisionNumber,
    testFiles: readonly TestFileRef[],
  ): CheckpointRecord {
    const record = this.#insert(id, kind, revision, testFiles);
    this.#active?.joined.push(record);
    this.#publish();
    return record;
  }

  /** Records a request that needs nothing run, completed at once, leaving the open one be. */
  completeAtOnce(id: string, kind: CheckpointKind, revision: RevisionNumber): CheckpointRecord {
    const record = this.#insert(id, kind, revision, []);
    this.store.checkpoints.finish(id, "completed", this.now());
    return record;
  }

  /**
   * Records a checkpoint that cannot run, abandoned at once and never
   * `completed`, even with no files: a `run --all` while the worktree waits
   * for an install (review wave 11, B1). Abandons the open one first.
   */
  abandon(
    id: string,
    kind: CheckpointKind,
    revision: RevisionNumber,
    testFiles: readonly TestFileRef[],
  ): CheckpointRecord {
    this.finish("abandoned");
    const record = this.#insert(id, kind, revision, testFiles);
    this.store.checkpoints.finish(id, "abandoned", this.now());
    return record;
  }

  /**
   * Takes up what a stopped daemon owed (task 001-219): `records` end with
   * the open checkpoint, which also runs `testFiles` (of them, `strict` only
   * from its own runs); with none open, they are the open checkpoint.
   */
  resume(
    records: readonly CheckpointRecord[],
    testFiles: readonly TestFileRef[],
    strict: readonly TestFileRef[],
  ): void {
    const [first, ...rest] = records;
    if (first === undefined) return;
    if (this.#active === null) {
      this.#active = {
        record: first,
        joined: rest,
        remaining: new Map(),
        strict: new Set(),
        total: 0,
        failed: false,
      };
    } else {
      this.#active.joined.push(...records);
    }
    this.#add(testFiles, strict);
    this.#settle();
  }

  /** `ref` got a result, attributed to checkpoint `by` (`StateProvenance.checkpointId`). */
  done(ref: TestFileRef, by: string | null): void {
    const active = this.#active;
    if (active === null) return;
    const id = testFileId(ref);
    if (active.strict.has(id) && by !== active.record.id) return;
    if (!active.remaining.delete(id)) return;
    this.#settle();
  }

  /** `ref` crashed or timed out: the checkpoint cannot complete. */
  failed(ref: TestFileRef): void {
    const active = this.#active;
    if (!active?.remaining.delete(testFileId(ref))) return;
    active.failed = true;
    this.#settle();
  }

  /** Ends the open checkpoint, if any, with every request joined to it. */
  finish(end: CheckpointEnd): void {
    const active = this.#active;
    if (active === null) return;
    this.#active = null;
    const at = this.now();
    for (const record of [active.record, ...active.joined]) {
      this.store.checkpoints.finish(record.id, end, at);
    }
    this.#publish();
  }

  /**
   * The daemon stops (task 001-219): an open explicit checkpoint is owed to
   * the next daemon, its `run --all` records left open; a baseline is
   * abandoned, as the next daemon runs its own. A failed one is abandoned.
   */
  owe(): void {
    const active = this.#active;
    if (active === null) return;
    const all = [active.record, ...active.joined];
    const owed = all.filter((record) => record.kind === "run-all");
    if (owed.length === 0 || active.failed) {
      this.finish("abandoned");
      return;
    }
    this.#active = null;
    const at = this.now();
    for (const record of all) {
      if (record.kind !== "run-all") this.store.checkpoints.finish(record.id, "abandoned", at);
    }
    const remaining = [...active.remaining.values()];
    const strict = [...active.remaining].filter(([id]) => active.strict.has(id)).map(([, r]) => r);
    const debt: OwedCheckpoint = { ids: owed.map((r) => r.id), remaining, strict };
    this.#write({ ...progress(active), owed: debt });
  }

  #insert(
    id: string,
    kind: CheckpointKind,
    revision: RevisionNumber,
    testFiles: readonly TestFileRef[],
  ): CheckpointRecord {
    return this.store.checkpoints.start({
      id,
      worktreeId: this.worktreeId,
      revision,
      kind,
      testFiles,
      startedAt: this.now(),
    });
  }

  #add(testFiles: readonly TestFileRef[], strict: readonly TestFileRef[]): void {
    const active = this.#active;
    if (active === null) return;
    for (const ref of testFiles) {
      const id = testFileId(ref);
      if (!active.remaining.has(id)) active.total++;
      active.remaining.set(id, ref);
    }
    for (const ref of strict) active.strict.add(testFileId(ref));
  }

  #settle(): void {
    const active = this.#active;
    if (active !== null && active.remaining.size === 0) {
      this.finish(active.failed ? "abandoned" : "completed");
    } else {
      this.#publish();
    }
  }

  #publish(): void {
    const active = this.#active;
    this.#write(active === null ? null : progress(active));
  }

  #write(value: CheckpointProgress | null): void {
    const text = value === null ? "" : JSON.stringify(value);
    if (text === this.#published) return;
    this.#published = text;
    this.store.meta.set(checkpointMetaKey(this.worktreeId), text);
  }
}

function explicit(active: Active): boolean {
  return [active.record, ...active.joined].some((record) => record.kind === "run-all");
}

function progress(active: Active): CheckpointProgress {
  const { record, total, remaining } = active;
  return {
    id: record.id,
    kind: explicit(active) ? "run-all" : record.kind,
    revision: record.revision,
    startedAt: record.startedAt,
    done: total - remaining.size,
    total,
  };
}
