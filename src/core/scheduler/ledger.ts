import { testFileId } from "../keys/index.js";
import type {
  CheckId,
  CheckKey,
  CommitSha,
  RelativePath,
  ResultRecord,
  RevisionNumber,
  TestFileKeyRecord,
  TestFileRef,
} from "../types/index.js";
import { Checkpoints } from "./checkpoints.js";
import { NOTHING_CHANGED, type SchedulerContext } from "./context.js";
import { checkId, type FileState, newFileState } from "./files.js";
import { type Priority, priorityOf, RunQueue } from "./queue.js";

/** After this many consecutive discarded tiers a file is `unknown` instead of re-queued. */
export const MAX_DISCARDS = 3;

export interface RevisionState {
  readonly number: RevisionNumber;
  readonly head: CommitSha;
  readonly dirty: boolean;
}

export interface SettleOptions {
  /** Checkpoint of lookup hits; defaults to the open checkpoint when it requested the file. */
  readonly checkpointId?: string | null;
  /** Queue the misses. Default `true`. */
  readonly queueMisses?: boolean;
}

/**
 * Every test file of the worktree, the run queue and the open checkpoint, plus
 * the writes they owe the store and the state sink.
 *
 * Mutations are buffered and `commit()` writes them in one store transaction,
 * in the order the `StateSink` contract asks for: `test_file_keys` first, then
 * results, unknowns and retirements to the sink, then `refresh` for validity.
 * Results of runs are stored (`results.putMany`) before `commit`.
 */
export class Ledger {
  readonly files = new Map<string, FileState>();
  readonly queue = new RunQueue();
  readonly checkpoints: Checkpoints;
  revision: RevisionState = { number: 0, head: null, dirty: false };
  /** Paths changed by revisions since the tier in flight was selected; `null` with no tier in flight. */
  tierChanges: Set<RelativePath> | null = null;
  readonly counters = {
    hits: 0,
    misses: 0,
    discarded: 0,
    started: 0,
    completed: 0,
    crashed: 0,
    timedOut: 0,
  };

  readonly #dirty = new Set<string>();
  readonly #removed: TestFileRef[] = [];
  #applied: { results: readonly ResultRecord[]; checkpointId: string | null }[] = [];
  #unknown: { testFiles: TestFileRef[]; reason: string }[] = [];
  #retired: CheckId[] = [];

  constructor(private readonly context: SchedulerContext) {
    this.checkpoints = new Checkpoints(context.store, context.worktreeId, context.now);
  }

  file(ref: TestFileRef): FileState | undefined {
    return this.files.get(testFileId(ref));
  }

  addFile(ref: TestFileRef): FileState {
    const file = newFileState(ref);
    this.files.set(file.id, file);
    this.#dirty.add(file.id);
    return file;
  }

  /** Forgets a test file that no longer exists and retires its checks. */
  removeFile(file: FileState): void {
    this.context.keys.removeTestFile(file.ref);
    this.queue.remove(file.ref);
    this.files.delete(file.id);
    this.#retired.push(...file.checks);
    this.#removed.push(file.ref);
    // Nothing is left to run for it.
    this.checkpoints.done(file.ref, this.checkpoints.idFor(file.ref));
  }

  /**
   * Takes each file's key from the key index and decides what it needs.
   *
   * Spec 001 D5 step 3: "looks each new key up in the store. A hit is promoted
   * to current for this worktree with its provenance intact. No run is
   * needed." A key that already has this worktree's results, that the tier in
   * flight runs, or that crashed (D12) needs nothing. Forced entries stay
   * queued. Returns the misses.
   */
  settle(
    refs: Iterable<TestFileRef>,
    changed: ReadonlySet<RelativePath>,
    options: SettleOptions = {},
  ): FileState[] {
    const misses: FileState[] = [];
    const seen = new Set<string>();
    for (const ref of refs) {
      const file = this.file(ref);
      if (!file || seen.has(file.id)) continue;
      seen.add(file.id);
      const key = this.context.keys.index.key(ref);
      if (key !== file.key) {
        file.key = key;
        this.#dirty.add(file.id);
      }
      if (this.queue.isForced(ref)) continue;
      if (
        key === null ||
        key === file.runningKey ||
        key === file.unknownKey ||
        key === file.resultKey
      ) {
        this.queue.remove(ref);
        this.#syncPhase(file);
        continue;
      }
      const hits = this.context.store.results.byKey(key, this.context.now());
      if (hits.length > 0) {
        this.counters.hits++;
        const checkpointId = options.checkpointId ?? this.checkpoints.idFor(ref);
        this.applyResults(file, key, hits, checkpointId);
        continue;
      }
      this.counters.misses++;
      misses.push(file);
      if (options.queueMisses !== false) this.enqueue(file, priorityOf(file, changed));
    }
    return misses;
  }

  /**
   * Makes `results` the current results of `file` under `key`: from a run of
   * this worktree or a lookup hit. Checks of the previous results that are
   * not among them are retired (D8).
   */
  applyResults(
    file: FileState,
    key: CheckKey,
    results: readonly ResultRecord[],
    checkpointId: string | null,
  ): void {
    if (results.length > 0) this.#applied.push({ results, checkpointId });
    const next = results.map((r) => r.check);
    const kept = new Set(next.map(checkId));
    this.#retired.push(...file.checks.filter((check) => !kept.has(checkId(check))));
    file.resultKey = key;
    file.checks = next;
    file.failing = results.some((r) => r.outcome === "fail");
    file.unknownKey = null;
    file.discards = 0;
    if (!this.queue.isForced(file.ref)) this.queue.remove(file.ref);
    this.#syncPhase(file);
    this.checkpoints.done(file.ref, checkpointId);
  }

  enqueue(file: FileState, priority: Priority, forced = false): void {
    this.queue.add(file.ref, priority, forced);
    this.#syncPhase(file);
  }

  /** The tier holding these files starts or ends. */
  setRunning(file: FileState, key: CheckKey | null): void {
    file.runningKey = key;
    this.#syncPhase(file);
  }

  /**
   * Spec 001 D12: a crash, a timeout, or inputs that never hold still. Nothing
   * is stored under a key; the files' checks become `unknown` at this revision.
   */
  markUnknown(entries: readonly { file: FileState; key: CheckKey }[], reason: string): void {
    if (entries.length === 0) return;
    for (const { file, key } of entries) {
      file.unknownKey = key;
      this.queue.remove(file.ref);
      this.#syncPhase(file);
      this.checkpoints.failed(file.ref);
    }
    this.#unknown.push({ testFiles: entries.map((e) => e.file.ref), reason });
  }

  /**
   * Spec 001 D5: "that file's results are discarded as unreliable and the file
   * is re-queued". After `MAX_DISCARDS` in a row the file is `unknown` until
   * its key changes: something rewrites its inputs during every run.
   */
  discard(file: FileState, key: CheckKey): void {
    this.counters.discarded++;
    file.discards++;
    if (file.discards >= MAX_DISCARDS) {
      this.markUnknown([{ file, key }], `inputs changed during ${MAX_DISCARDS} runs in a row`);
    } else if (file.key !== null) {
      this.enqueue(file, priorityOf(file, NOTHING_CHANGED));
    }
  }

  /** Writes what this round of work owes the store and the sink, in one transaction. */
  commit(): void {
    const { store, sink, worktreeId } = this.context;
    const revision = this.revision.number;
    const rows: TestFileKeyRecord[] = [];
    const unkeyed = this.#removed.splice(0);
    for (const id of this.#dirty) {
      const file = this.files.get(id);
      if (!file) continue;
      if (file.key === null) unkeyed.push(file.ref);
      else
        rows.push({ worktreeId, testFile: file.ref, key: file.key, revision, pending: file.phase });
    }
    this.#dirty.clear();
    const applied = this.#applied;
    const unknown = this.#unknown;
    const retired = this.#retired;
    this.#applied = [];
    this.#unknown = [];
    this.#retired = [];

    store.transaction(() => {
      if (rows.length > 0) store.testFileKeys.upsertMany(rows);
      if (unkeyed.length > 0) store.testFileKeys.remove(worktreeId, unkeyed);
      for (const { results, checkpointId } of applied) {
        sink.applyResults(worktreeId, revision, results, { checkpointId });
      }
      for (const { testFiles, reason } of unknown) {
        sink.markUnknown(worktreeId, revision, testFiles, reason);
      }
      if (retired.length > 0) sink.retire(worktreeId, retired);
      if (rows.length > 0 || unkeyed.length > 0) {
        const checkpointId = this.checkpoints.active?.record.id ?? null;
        sink.refresh(worktreeId, revision, { checkpointId });
      }
    });
  }

  /** Phase follows the queue and the tier in flight; a change is owed to `test_file_keys`. */
  #syncPhase(file: FileState): void {
    const phase = file.runningKey !== null ? "running" : this.queue.has(file.ref) ? "queued" : null;
    if (phase === file.phase) return;
    file.phase = phase;
    this.#dirty.add(file.id);
  }

  /** Marks a file's key row as owed, for callers that change a file directly. */
  touch(file: FileState): void {
    this.#dirty.add(file.id);
  }
}
