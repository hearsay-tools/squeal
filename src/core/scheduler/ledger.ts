import { testFileId } from "../keys/index.js";
import {
  type CheckId,
  type CheckKey,
  type CommitSha,
  type RelativePath,
  type ResultRecord,
  type RevisionNumber,
  refinedMetaKey,
  type TestFileKeyRecord,
  type TestFileRef,
} from "../types/index.js";
import { Checkpoints } from "./checkpoints.js";
import { NOTHING_CHANGED, type SchedulerContext } from "./context.js";
import { checkId, durationOf, type FileState, newFileState } from "./files.js";
import { type Priority, priorityOf, RunQueue } from "./queue.js";

/** After this many consecutive discarded tiers at an unmoved key a file is `unknown` instead of re-queued. */
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
  /** `testFileId`s the runner reported as direct importers of `changed` (D5 step 4). */
  readonly direct?: ReadonlySet<string>;
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
  /**
   * Paths changed by revisions since the runner phase of the refinement in
   * flight started; `null` with none in flight (`applyRunnerPart`).
   */
  refineChanges: Set<RelativePath> | null = null;
  /** Some files are blocked by a runner failure; the next revision or `run --all` retries the runner. */
  broken = false;
  /** The last test file listing failed; the next revision lists again. */
  listingFailed = false;

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

  /** The queue in run order: D5 step 4 classes, shortest last known duration first within one. */
  ordered(): TestFileRef[] {
    return this.queue.ordered((ref) => this.file(ref)?.durationMs ?? null);
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
   *
   * A miss is queued as recent when `changed` holds the test file or a path
   * of its closure, or the runner named it a direct importer: work an edit
   * caused, which runs ahead of the rest (D5 step 4 as amended, task
   * 001-100). An environment input is in no closure, so the files an install
   * or a config change re-keys are not.
   */
  settle(
    refs: Iterable<TestFileRef>,
    changed: ReadonlySet<RelativePath>,
    options: SettleOptions = {},
  ): FileState[] {
    const misses: FileState[] = [];
    const seen = new Set<string>();
    const recent = this.recentOf(changed, options.direct);
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
        const checkpointId = options.checkpointId ?? this.checkpoints.idFor(ref);
        this.applyResults(file, key, hits, checkpointId);
        continue;
      }
      misses.push(file);
      if (file.blocked !== null) {
        // The runner cannot run it; it stays `unknown` until the runner recovers.
        this.queue.remove(ref);
        this.#syncPhase(file);
      } else if (options.queueMisses !== false) {
        this.enqueue(file, priorityOf(file, changed, options.direct), false, recent.has(file.id));
      }
    }
    return misses;
  }

  /** `testFileId`s of the test files `changed` edited or added, or whose closure it touches. */
  recentOf(changed: ReadonlySet<RelativePath>, direct?: ReadonlySet<string>): Set<string> {
    const ids = new Set(direct);
    if (changed.size === 0) return ids;
    for (const ref of this.context.keys.index.reverse.referencing(changed))
      ids.add(testFileId(ref));
    for (const file of this.files.values()) if (changed.has(file.ref.path)) ids.add(file.id);
    return ids;
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
    file.durationMs = durationOf(results) ?? file.durationMs;
    file.unknownKey = null;
    file.discards = 0;
    file.blocked = null;
    if (!this.queue.isForced(file.ref)) this.queue.remove(file.ref);
    this.#syncPhase(file);
    this.checkpoints.done(file.ref, checkpointId);
  }

  enqueue(file: FileState, priority: Priority, forced = false, recent = false): void {
    this.queue.add(file.ref, priority, forced, recent);
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
   * Spec 001 D5: a checkpoint containing an `unknown` file ends `abandoned`.
   */
  markUnknown(entries: readonly { file: FileState; key: CheckKey | null }[], reason: string): void {
    if (entries.length === 0) return;
    for (const { file, key } of entries) {
      file.unknownKey = key;
      // A file queued again for a newer key during the run still needs that run.
      if (file.key === key && !this.queue.isForced(file.ref)) this.queue.remove(file.ref);
      this.#syncPhase(file);
      this.checkpoints.failed(file.ref);
    }
    this.#unknown.push({ testFiles: entries.map((e) => e.file.ref), reason });
  }

  /**
   * Spec 001 D5: "that file's results are discarded as unreliable and the file
   * is re-queued". After `MAX_DISCARDS` in a row at a key that did not move the
   * file is `unknown` until its key changes: something rewrites its inputs
   * during every run. A discard whose key moved is an edit the agent made
   * while the file ran; it is not counted (review S5).
   */
  discard(file: FileState, key: CheckKey): void {
    file.discards = file.key === key ? file.discards + 1 : 0;
    if (file.discards >= MAX_DISCARDS) {
      this.markUnknown([{ file, key }], `inputs changed during ${MAX_DISCARDS} runs in a row`);
    } else if (file.key !== null && file.blocked === null) {
      this.enqueue(file, priorityOf(file, NOTHING_CHANGED));
    }
  }

  /**
   * Files whose run read a path first seen during it (`ObservedGrowth.firstSeen`,
   * task 001-134), once `settle` moved them to the key with that path: they
   * re-run under it. Counted with `discard`'s, since their own growth, not an
   * edit, moved the key; at `MAX_DISCARDS` in a row the file is `unknown`
   * until its key changes, so a run that reads a new path every time cannot
   * re-run forever. A file `settle` gave a result at the new key (another
   * worktree stored it) is current and not counted.
   */
  rerunFirstSeen(files: readonly FileState[]): void {
    const exhausted: { file: FileState; key: CheckKey }[] = [];
    for (const file of files) {
      if (file.key === null || file.resultKey === file.key) continue;
      file.discards += 1;
      if (file.discards >= MAX_DISCARDS) exhausted.push({ file, key: file.key });
    }
    this.markUnknown(exhausted, `${MAX_DISCARDS} runs in a row read paths no earlier run had read`);
  }

  /**
   * Writes what this round of work owes the store and the sink, in one
   * transaction. `refined` is the revision whose runner part this commit
   * applies; it becomes the worktree's refined revision (`refinedMetaKey`,
   * spec 001 D2 as amended), so headers stop counting that runner part as
   * pending in the same transaction that applies it.
   */
  commit(options: { readonly refined?: RevisionNumber } = {}): void {
    const { store, sink, worktreeId } = this.context;
    const revision = this.revision.number;
    const rows: TestFileKeyRecord[] = [];
    const removed = this.#removed.splice(0);
    for (const id of this.#dirty) {
      const file = this.files.get(id);
      if (!file) continue;
      // An unkeyed file keeps its row with a null key: status counts it as unknown (B1).
      const pending = file.key === null ? null : file.phase;
      rows.push({ worktreeId, testFile: file.ref, key: file.key, revision, pending });
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
      if (removed.length > 0) store.testFileKeys.remove(worktreeId, removed);
      for (const { results, checkpointId } of applied) {
        sink.applyResults(worktreeId, revision, results, { checkpointId });
      }
      for (const { testFiles, reason } of unknown) {
        sink.markUnknown(worktreeId, revision, testFiles, reason);
      }
      if (retired.length > 0) sink.retire(worktreeId, retired);
      // Only rows that changed: no other file's key, phase or validity moved.
      // Each file is attributed to the checkpoint that requested it (review S9).
      for (const [checkpointId, testFiles] of this.#byCheckpoint(rows)) {
        sink.refresh(worktreeId, revision, { checkpointId }, testFiles);
      }
      if (options.refined !== undefined) {
        store.meta.set(refinedMetaKey(worktreeId), String(options.refined));
      }
    });
  }

  #byCheckpoint(rows: readonly TestFileKeyRecord[]): Map<string | null, TestFileRef[]> {
    const groups = new Map<string | null, TestFileRef[]>();
    for (const { testFile } of rows) {
      const id = this.checkpoints.idFor(testFile);
      const group = groups.get(id);
      if (group) group.push(testFile);
      else groups.set(id, [testFile]);
    }
    return groups;
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
