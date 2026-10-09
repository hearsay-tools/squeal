import { testFileId } from "../keys/index.js";
import { inheritsAcrossWorktrees } from "../slow/index.js";
import { heldFailure } from "../state/index.js";
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
import { takeHeldFiles } from "./held.js";
import { type Priority, priorityOf, RunQueue } from "./queue.js";
import { endRerun } from "./rerun.js";
import { slowView } from "./slow.js";

/** Results `applyResults` made current, owed to the sink at the next commit. */
interface Applied {
  readonly results: readonly ResultRecord[];
  readonly checkpointId: string | null;
}

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
  /**
   * One set per tier in flight (`Tier.changes`): each collects the paths
   * revisions changed since its tier was selected (task 001-140: tiers of
   * two lanes overlap).
   */
  readonly tierChanges = new Set<Set<RelativePath>>();
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
  #applied: Applied[] = [];
  #unknown: { testFiles: TestFileRef[]; reason: string }[] = [];
  #retired: CheckId[] = [];

  constructor(private readonly context: SchedulerContext) {
    this.checkpoints = new Checkpoints(context.store, context.worktreeId, context.now);
    // Read at every query: a reload replaces `context.policy`.
    this.queue.setSlow((ref) => slowView(context.policy).isSlow(ref));
  }

  file(ref: TestFileRef): FileState | undefined {
    return this.files.get(testFileId(ref));
  }

  /** The queue in run order: D5 step 4 classes, shortest last known duration first within one. */
  ordered(): TestFileRef[] {
    return this.queue.ordered((ref) => this.file(ref)?.durationMs ?? null);
  }

  /** The slow class of the queue in the order the slow tier runs it (spec 004 D2). */
  orderedSlow(): TestFileRef[] {
    return this.queue.orderedSlow((ref) => this.file(ref)?.durationMs ?? null);
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
      // A re-run queued for another key is no re-run here: the new key runs as any miss (S1).
      if (file.rerunPending && key !== file.rerunKey) {
        endRerun(this.context, file);
        this.queue.remove(ref);
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
      const hits = this.lookup(file, key);
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

  /**
   * The stored results of `key` that may stand for `file`: every hit, unless
   * one comes from another worktree and the file may not inherit (spec 004
   * D6, `inherits`), or one is another worktree's fail this worktree has not
   * confirmed (spec 001 D6 as amended, task 001-170, `heldFailure`), when
   * there is none: the file is a miss and runs here, and its local result
   * replaces the shared row. The store holds one result per check and key,
   * so a mixed set is never partly this worktree's own.
   */
  lookup(file: FileState, key: CheckKey): readonly ResultRecord[] {
    const { store, worktreeId, now } = this.context;
    const hits = store.results.byKey(key, now());
    if (hits.every((hit) => hit.provenance.worktreeId === worktreeId)) return hits;
    if (!this.inherits(file.ref)) return [];
    return heldFailure(store, worktreeId, hits) === undefined ? hits : [];
  }

  /** Spec 004 D6: whether another worktree's result may stand for `ref`. */
  inherits(ref: TestFileRef): boolean {
    const view = slowView(this.context.policy);
    const slow = view.isSlow(ref);
    if (!slow) return true;
    const testFiles = new Set([...this.files.values()].map((file) => file.ref.path));
    const declared = this.context.keys.declaredFor(ref.path);
    return inheritsAcrossWorktrees({ path: ref.path, slow }, declared, testFiles, view.globs);
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

  /**
   * Review wave 13i, B1: queues the files another worktree's heal left held
   * here (`takeHeldFiles`). A file still at that key loses its `resultKey`,
   * the shortcut that would count it done, and is queued at its normal D5
   * priority unless a tier runs it; every such file's row is written again,
   * so the `queued` the heal wrote gives way to the phase held here. Returns
   * whether there were any, so the caller commits.
   */
  confirmHeld(): boolean {
    const held = takeHeldFiles(this.context.store, this.context.worktreeId);
    for (const { testFile, key } of held) {
      const file = this.file(testFile);
      if (!file) continue;
      this.touch(file);
      if (file.key !== key || file.runningKey === key) continue;
      if (file.resultKey === key) file.resultKey = null;
      if (file.blocked === null) this.enqueue(file, priorityOf(file, NOTHING_CHANGED));
    }
    return held.length > 0;
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
  discard(file: FileState, key: CheckKey, forced = false): void {
    file.discards = file.key === key ? file.discards + 1 : 0;
    if (file.discards >= MAX_DISCARDS) {
      this.markUnknown([{ file, key }], `inputs changed during ${MAX_DISCARDS} runs in a row`);
    } else if (file.key !== null && file.blocked === null) {
      // A forced run, a re-run among them (task 001-171), stays forced: its lookup would take its own fail.
      this.enqueue(file, priorityOf(file, NOTHING_CHANGED), forced && file.key === key);
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
      for (const { results, checkpointId } of mergeApplied(applied)) {
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

/**
 * Task 001-161: one sink call per run of consecutive entries of one
 * checkpoint, not one per file. Each call lists every known state and key of
 * the worktree inside the commit's write transaction: per file, applying a
 * 198-file tier held the lock 11 to 17 s with 4,982 states and 59 to 67 s
 * with 15,468 (cezar's store), and a daemon starting beside such a tier
 * exited on "database is locked". A check
 * met again starts a new call, so it sees the state the one before wrote, as
 * separate calls did.
 */
function mergeApplied(applied: readonly Applied[]): Applied[] {
  const merged: { results: ResultRecord[]; checkpointId: string | null }[] = [];
  let seen = new Set<string>();
  for (const { results, checkpointId } of applied) {
    const ids = results.map((r) => checkId(r.check));
    const last = merged.at(-1);
    if (
      last === undefined ||
      last.checkpointId !== checkpointId ||
      ids.some((id) => seen.has(id))
    ) {
      merged.push({ results: [...results], checkpointId });
      seen = new Set(ids);
      continue;
    }
    last.results.push(...results);
    for (const id of ids) seen.add(id);
  }
  return merged;
}
