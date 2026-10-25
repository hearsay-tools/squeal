import { testFileId } from "../keys/index.js";
import { fsRankSource, SlowRanker } from "../slow/rank.js";
import { metaTokenRecords, publishSlowEvidence, readSlowEvidence } from "../slow/rank-store.js";
import { isBusy } from "../store/index.js";
import {
  type CheckId,
  type CheckKey,
  type CommitSha,
  type MarkedUnknown,
  type RelativePath,
  type ResultRecord,
  type RevisionNumber,
  refinedMetaKey,
  type SetupOutcome,
  type TestFileKeyRecord,
  type TestFileRef,
} from "../types/index.js";
import { acceptedAt, currentChecks, type ReadAsOne } from "./accept.js";
import { Checkpoints } from "./checkpoints.js";
import { Claims } from "./claims.js";
import { NOTHING_CHANGED, type SchedulerContext } from "./context.js";
import {
  checkId,
  classify,
  clearKeyedAt,
  durationOf,
  type FileState,
  newFileState,
  noteKeyedAt,
} from "./files.js";
import { takeHeldFiles } from "./held.js";
import { sinkWithoutResults } from "./hold.js";
import { publishPromotions } from "./promotions.js";
import { type Priority, priorityOf, RunQueue } from "./queue.js";
import { adoptsAtFirstCommit, movesWouldChange, recordMoves } from "./rekeyed-moves.js";
import { recordRekeyed } from "./rekeyed-record.js";
import { endRerun } from "./rerun.js";
import { dropRetry, lapseRetry } from "./retries.js";
import { SetupFailures } from "./setup.js";
import { slowView } from "./slow.js";
import {
  type RecordedCause,
  recordUnknownFiles,
  samplesOf,
  type UnknownFileRecord,
} from "./unknown-files.js";

/** Results `applyResults` made current, owed to the sink at the next commit. */
interface Applied {
  readonly results: readonly ResultRecord[];
  readonly checkpointId: string | null;
}

/** What `commit` takes from the ledger: put back when its transaction gives up on a busy store (row 011-126). */
interface Drained {
  readonly dirty: readonly string[];
  readonly removed: readonly TestFileRef[];
  readonly rekeyed: readonly (readonly [string, RevisionNumber | null])[];
  readonly applied: readonly Applied[];
  readonly unknown: readonly MarkedUnknown[];
  readonly unknownFiles: readonly Omit<UnknownFileRecord, "revision" | "at">[];
  readonly retired: readonly CheckId[];
  readonly setups: readonly SetupOutcome[];
}

/** A lookup `settle` skips: no hit, and nothing withheld. */
const UNPROBED = { hits: [], mayWait: true } as const;

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
  /** Queue the misses. Default `true`. `false` still queues a held fail unless `heldFails` is given. */
  readonly queueMisses?: boolean;
  /**
   * Collects the `testFileId`s of the misses whose key holds another
   * worktree's fail this worktree has not confirmed (001 D6, task 001-170),
   * which only a local run confirms or clears (011 C4 step 3 as amended
   * 2026-10-23, row 011-159), and drops a miss whose key holds none. Absent,
   * `queueMisses: false` still queues such a miss; the start collects them
   * and queues its misses itself.
   */
  readonly heldFails?: Set<string>;
  /** `testFileId`s the runner reported as direct importers of `changed` (D5 step 4). */
  readonly direct?: ReadonlySet<string>;
  /**
   * The revision whose change these key moves belong to, recorded on each
   * file whose key moves (`FileState.keyedAt`, task 001-186) unless an
   * earlier one still has no result there (task 001-194). Absent: the move
   * is the baseline's, a backlog's or a run's, and records nothing.
   */
  readonly keyedAt?: RevisionNumber;
  /**
   * `changed` is a catch-up revision's (`isCatchUp`, spec 011 C4 step 4 as
   * amended 2026-10-20, task 011-22): the misses an edit's work would be
   * are queued as catch-up instead.
   */
  readonly catchUp?: boolean;
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
  /** Other worktrees' claims this worktree's queued files wait on (task 001-205). */
  readonly claims: Claims;
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
  /**
   * A departure drain pauses the backlog (011 C9 as amended 2026-10-21, row
   * 011-93): `ordered` and `fastQueued` hold only the drain's files, and the
   * paused ones stay queued for the next daemon.
   */
  backlogPaused = false;
  /** Row 011-72: `ref`'s key names an unmerged path, so it takes no stored result (the merge hold). */
  holds: (ref: TestFileRef) => boolean = () => false;
  /** Global setups that failed to start a run, and their outcomes owed to the sink (task 001-382). */
  readonly setups = new SetupFailures();

  readonly #dirty = new Set<string>();
  readonly #removed: TestFileRef[] = [];
  #applied: Applied[] = [];
  /** Each `markUnknown` since the last commit, with the run behind it (row 011-108). */
  #unknown: MarkedUnknown[] = [];
  /** Why each file marked since the last commit is `unknown`, owed to `meta` (task 001-403). */
  #unknownFiles: Omit<UnknownFileRecord, "revision" | "at">[] = [];
  #retired: CheckId[] = [];
  /**
   * Files whose re-key attribution moved since the last commit, with the
   * latest revision that re-keyed one (`null`: only discharged), owed to the
   * store's records (`recordRekeyed`, task 001-238; `recordMoves`, task
   * 001-258).
   */
  readonly #rekeyed = new Map<string, RevisionNumber | null>();
  /** A commit took in the rows the store's writers before this ledger left pending (`recordMoves`). */
  #adopted = false;
  /** Spec 004 D2's evidence order (task 004-82): token records by the key cache's hashes. */
  readonly #ranker: SlowRanker;
  /** Each file's key and keys read as one at its last read (`acceptedAt`), by `testFileId` (011-38, 0.1.285 B1). */
  readonly #readAsOne = new Map<string, string>();
  /** The formats read as one, as `acceptedAt` reads them: the key index's keys, this daemon's reads. */
  readonly #listed: ReadAsOne = {
    keys: (key) => this.context.keys.index.keysReadAsOne(key),
    read: this.#readAsOne,
  };

  constructor(private readonly context: SchedulerContext) {
    this.checkpoints = new Checkpoints(context.store, context.worktreeId, context.now);
    this.claims = new Claims(context);
    // Read at every query: a reload replaces `context.policy`.
    this.queue.setSlow((ref) => slowView(context.policy).isSlow(ref));
    this.queue.setPromotionClock(
      context.now,
      (ref) => (this.file(ref)?.runningKey ?? null) !== null,
      (live) => publishPromotions(context.store, context.worktreeId, live, context.now()),
    );
    this.#ranker = new SlowRanker(
      fsRankSource(context.root, (path) => context.keys.cache.hashOf(path)),
      metaTokenRecords(context.store),
    );
  }

  file(ref: TestFileRef): FileState | undefined {
    return this.files.get(testFileId(ref));
  }

  /**
   * The queue in run order: D5 step 4 classes, shortest last known duration
   * first within one; `turn` false orders it as if the backlog's turn were
   * not due. While the backlog is paused, only the drain's files.
   */
  ordered(turn = this.queue.backlogTurn()): TestFileRef[] {
    const ordered = this.queue.ordered((ref) => this.file(ref)?.durationMs ?? null, turn);
    return this.backlogPaused ? ordered.filter((ref) => this.#drains(ref)) : ordered;
  }

  /** Whether a fast file `where` holds is queued to run: while the backlog is paused, a drain's. */
  fastQueued(where: (ref: TestFileRef) => boolean = () => true): boolean {
    return this.queue.hasFast((ref) => where(ref) && (!this.backlogPaused || this.#drains(ref)));
  }

  /** A file a drain runs: an edit's work or a promoted file, the open explicit checkpoint's, a re-run. */
  #drains(ref: TestFileRef): boolean {
    if (this.queue.isFirstGroup(ref) || this.file(ref)?.rerunPending === true) return true;
    return this.checkpoints.active?.explicit === true && this.checkpoints.idFor(ref) !== null;
  }

  /**
   * The slow class of the queue in the order the slow tier runs it (spec 004
   * D2): by evidence within a class unless `slow.rank` is `"duration"`.
   */
  orderedSlow(): TestFileRef[] {
    return this.queue.orderedSlow(
      (ref) => this.file(ref)?.durationMs ?? null,
      this.context.policy.slow.rank !== "duration",
    );
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
    this.#readAsOne.delete(file.id);
    dropRetry(this.context, file);
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
   * or a config change re-keys are not. With `catchUp` such a miss is
   * catch-up instead (011 C4 step 4 as amended 2026-10-20, task 011-22).
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
        if (options.keyedAt !== undefined) {
          noteKeyedAt(file, options.keyedAt);
          this.#rekeyed.set(file.id, Math.max(this.#rekeyed.get(file.id) ?? 0, options.keyedAt));
        }
        this.#dirty.add(file.id);
      }
      // A re-run queued for another key is no re-run here: the new key runs as any miss (S1).
      if (file.rerunPending && key !== file.rerunKey) {
        endRerun(this.context, file);
        this.queue.remove(ref);
      }
      // The agent's retry was asked at the key it had: it lapses here (001-368).
      if (lapseRetry(this.context, file, key) && !file.rerunPending) this.queue.remove(ref);
      if (this.queue.isForced(ref)) continue;
      // Row 011-120: `run --all --force` counts only its own run of a file (task 001-217). One it
      // holds that runs at another key takes no stored result here: it runs forced at this key.
      const strict =
        file.runningKey !== null && key !== file.runningKey && this.checkpoints.covers([ref], true);
      // Row 011-72: while on hold, a key that names an unmerged path takes no stored result,
      // its own included; it stays queued, and takes it at a tier boundary once the hold ends.
      const held = key !== null && this.holds(ref);
      if (
        key === null ||
        (!strict &&
          (key === file.runningKey || key === file.unknownKey || (key === file.resultKey && !held)))
      ) {
        if (key !== null && (key === file.resultKey || key === file.unknownKey))
          this.#discharge(file);
        this.queue.remove(ref);
        this.#syncPhase(file);
        // Row 011-118: back at the key its results stand under, it is current by lookup.
        if (classify(file) === "current") this.checkpoints.done(ref, null);
        continue;
      }
      const { hits, mayWait } = held || strict ? UNPROBED : this.probe(key);
      if (hits.length > 0) {
        const checkpointId = options.checkpointId ?? this.checkpoints.idFor(ref);
        this.applyResults(file, key, hits, checkpointId);
        continue;
      }
      misses.push(file);
      // Results are stored at the key and none stands: another worktree's unconfirmed fail.
      const heldFail = !mayWait;
      if (heldFail) options.heldFails?.add(file.id);
      else options.heldFails?.delete(file.id);
      if (file.blocked !== null) {
        // The runner cannot run it; it stays `unknown` until the runner recovers.
        this.queue.remove(ref);
        this.#syncPhase(file);
      } else if (
        strict ||
        options.queueMisses !== false ||
        (heldFail && options.heldFails === undefined)
      ) {
        const reached = recent.has(file.id);
        const catchUp = reached && options.catchUp === true;
        const priority = priorityOf(file, changed, options.direct);
        this.enqueue(file, priority, strict, reached && !catchUp, catchUp, options.keyedAt);
      }
    }
    this.#rank(changed, misses);
    return misses;
  }

  /**
   * Spec 004 D2 as amended 2026-10-18 (task 004-82): the slow files `changed`
   * queued gather the tokens of its files that they match, and `why` reads
   * them. Ranking only reorders: nothing is queued or dropped here.
   */
  #rank(changed: ReadonlySet<RelativePath>, misses: readonly FileState[]): void {
    if (changed.size === 0 || this.context.policy.slow.rank === "duration") return;
    const queued = misses.filter((f) => this.queue.has(f.ref) && this.queue.isSlow(f.ref));
    if (queued.length === 0) return;
    const slow = [...this.files.values()].filter((f) => this.queue.isSlow(f.ref));
    const evidence = this.#ranker.evidence(
      changed,
      slow.map((f) => f.ref.path),
    );
    const { store, worktreeId } = this.context;
    const ranked = readSlowEvidence(store, worktreeId);
    for (const [id, entry] of ranked) if (this.files.get(id)?.key !== entry.key) ranked.delete(id);
    let moved = false;
    for (const file of queued) {
      const tokens = evidence.get(file.ref.path);
      if (tokens === undefined || file.key === null) continue;
      this.queue.addEvidence(file.ref, tokens);
      ranked.set(file.id, { key: file.key, tokens: [...this.queue.evidenceOf(file.ref)] });
      moved = true;
    }
    if (moved) publishSlowEvidence(store, worktreeId, ranked);
  }

  /**
   * The stored results of `key` that may stand for its file (`acceptedAt`):
   * when there are none, the file is a miss and runs here.
   */
  lookup(key: CheckKey): readonly ResultRecord[] {
    return this.probe(key).hits;
  }

  /**
   * `lookup`, and whether a miss may wait on another worktree's claim of
   * `key` (task 001-205): the accept rule's (`acceptedAt`), the formats read
   * as one once per file and key in this daemon (task 011-38). No hits and
   * `mayWait` false: results are stored and withheld, another worktree's
   * unconfirmed fail (row 011-159).
   */
  probe(key: CheckKey): { hits: readonly ResultRecord[]; mayWait: boolean } {
    const { store, worktreeId, now } = this.context;
    return acceptedAt(store, worktreeId, key, now, this.#listed);
  }

  /**
   * The next lookup of each of `refs` reads the formats read as one again:
   * another worktree stored at one of them since (`StoredKeys`, task 011-38).
   */
  rereadFormats(refs: Iterable<TestFileRef>): void {
    for (const ref of refs) this.#readAsOne.delete(testFileId(ref));
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
   * not among them are retired (D8, `currentChecks`).
   */
  applyResults(
    file: FileState,
    key: CheckKey,
    results: readonly ResultRecord[],
    checkpointId: string | null,
  ): void {
    if (results.length > 0) this.#applied.push({ results, checkpointId });
    const { checks, retired } = currentChecks(file.checks, results);
    this.#retired.push(...retired);
    file.resultKey = key;
    file.resultsApplied += 1;
    file.checks = checks;
    file.failing = results.some((r) => r.outcome === "fail");
    file.durationMs = durationOf(results) ?? file.durationMs;
    file.unknownKey = null;
    file.discards = 0;
    file.blocked = null;
    file.tierCap = null;
    if (key === file.key) this.#discharge(file);
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

  enqueue(
    file: FileState,
    priority: Priority,
    forced = false,
    recent = false,
    catchUp = false,
    by?: RevisionNumber,
  ): void {
    this.queue.add(file.ref, priority, forced, recent, catchUp, by ?? null);
    this.#syncPhase(file);
  }

  /** Takes `file` out of the queue; whether it was queued. */
  dequeue(file: FileState): boolean {
    if (!this.queue.has(file.ref)) return false;
    this.queue.remove(file.ref);
    this.#syncPhase(file);
    return true;
  }

  /** The tier holding these files starts or ends. */
  setRunning(file: FileState, key: CheckKey | null): void {
    file.runningKey = key;
    this.#syncPhase(file);
  }

  /**
   * The tier that ran `file` at `key` ends, superseded by a newer run at
   * another key: only its own claim ends, since a store hit at the newer key
   * took none (row 011-71).
   */
  endRunningAt(file: FileState, key: CheckKey): void {
    if (file.runningKey === key) this.setRunning(file, null);
  }

  /**
   * Spec 001 D12: a crash, a timeout, or inputs that never hold still. Nothing
   * is stored under a key; the files' checks become `unknown` at this revision.
   * Spec 001 D5: a checkpoint containing an `unknown` file ends `abandoned`.
   * Task 001-403: each file's reason is kept in `meta` for status, `ran`
   * when its run completed and stored nothing, with a few `samples` paths,
   * and its `cause` where the reason's words alone do not say what advances
   * it (row 011-27). Row 011-108: `runId`, the run whose end made them
   * `unknown`, is recorded beside their states; none when no run did.
   */
  markUnknown(
    entries: readonly { file: FileState; key: CheckKey | null; samples?: Iterable<RelativePath> }[],
    reason: string,
    {
      ran = false,
      cause,
      runId = null,
    }: {
      readonly ran?: boolean;
      readonly cause?: RecordedCause;
      readonly runId?: string | null;
    } = {},
  ): void {
    if (entries.length === 0) return;
    for (const { file, key, samples } of entries) {
      this.#unknownFiles.push({
        testFile: file.ref,
        key,
        reason,
        ran,
        samples: samplesOf(samples ?? []),
        ...(cause === undefined ? {} : { cause }),
      });
      file.unknownKey = key;
      if (key === file.key) this.#discharge(file);
      // A file queued again for a newer key during the run still needs that run.
      if (file.key === key && !this.queue.isForced(file.ref)) this.queue.remove(file.ref);
      this.#syncPhase(file);
      this.checkpoints.failed(file.ref);
    }
    this.#unknown.push({ testFiles: entries.map((e) => e.file.ref), reason, runId });
  }

  /**
   * Spec 001 D5: "that file's results are discarded as unreliable and the file
   * is re-queued". After `MAX_DISCARDS` in a row at a key that did not move the
   * file is `unknown` until its key changes: something rewrites its inputs
   * during every run. A discard whose key moved is an edit the agent made
   * while the file ran; it is not counted (review S5). `reason` replaces the
   * content discard's at the limit: a run the runner withheld gives its own
   * (issue 10, task 011-06).
   */
  discard(
    file: FileState,
    key: CheckKey,
    forced = false,
    changed: Iterable<RelativePath> = [],
    reason = `inputs changed during ${MAX_DISCARDS} runs in a row`,
    runId: string | null = null,
  ): void {
    file.discards = file.key === key ? file.discards + 1 : 0;
    if (file.discards >= MAX_DISCARDS) {
      this.markUnknown([{ file, key, samples: changed }], reason, { ran: true, runId });
    } else if (file.key !== null && file.blocked === null) {
      this.enqueue(file, priorityOf(file, NOTHING_CHANGED), this.staysForced(file, key, forced));
    }
  }

  /**
   * Whether a forced run of `file` at `key` that did not store its result
   * is queued forced again (row 011-120, 011 C4 step 5): while the file is
   * still at `key`, where a lookup would take the run's own fail (a re-run,
   * task 001-171), or while the open checkpoint holds it strict
   * (`run --all --force`, task 001-107), which counts only its own run. A
   * file whose key moved otherwise drops it, and the new key runs as any
   * miss (001-171 S1); forced, `settle` would skip its lookup at every later
   * key.
   */
  staysForced(file: FileState, key: CheckKey, forced: boolean): boolean {
    return forced && (file.key === key || this.checkpoints.covers([file.ref], true));
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
  rerunFirstSeen(
    files: readonly { file: FileState; firstSeen: readonly RelativePath[] }[],
    runId: string | null = null,
  ): void {
    const exhausted: { file: FileState; key: CheckKey; samples: readonly RelativePath[] }[] = [];
    for (const { file, firstSeen } of files) {
      if (file.key === null || file.resultKey === file.key) continue;
      file.discards += 1;
      if (file.discards >= MAX_DISCARDS)
        exhausted.push({ file, key: file.key, samples: firstSeen });
    }
    this.markUnknown(
      exhausted,
      `${MAX_DISCARDS} runs in a row read paths no earlier run had read`,
      { ran: true, runId },
    );
  }

  /**
   * Writes what this round of work owes the store and the sink, in one
   * transaction. `refined` is the revision whose runner part this commit
   * applies; it becomes the worktree's refined revision (`refinedMetaKey`,
   * spec 001 D2 as amended), so headers stop counting that runner part as
   * pending in the same transaction that applies it.
   */
  commit(options: { readonly refined?: RevisionNumber } = {}): void {
    const drained = this.#drain();
    try {
      this.#write(drained, options);
    } catch (error) {
      // Row 011-126: a busy store gave up before the transaction wrote anything; the next commit writes it.
      if (isBusy(error)) this.#putBack(drained);
      throw error;
    }
  }

  /** `commit`'s rows and its one transaction, from what it drained. */
  #write(drained: Drained, options: { readonly refined?: RevisionNumber }): void {
    const { store, sink, worktreeId } = this.context;
    const revision = this.revision.number;
    const rows: TestFileKeyRecord[] = [];
    const { removed, applied, unknown, retired, setups } = drained;
    const rekeyed = drained.rekeyed.flatMap(([id, moved]) => {
      const file = this.files.get(id);
      return file ? [{ id, open: file.keyedAt, moved }] : [];
    });
    for (const id of drained.dirty) {
      const file = this.files.get(id);
      if (!file) continue;
      // An unkeyed file keeps its row with a null key: status counts it as unknown (B1).
      const pending = file.key === null ? null : file.phase;
      rows.push({ worktreeId, testFile: file.ref, key: file.key, revision, pending });
    }
    const unknownFiles = drained.unknownFiles.map((e) => ({
      ...e,
      revision,
      at: this.context.now(),
    }));

    const quiet =
      this.#adopted &&
      options.refined === undefined &&
      [rows, removed, rekeyed, applied, unknown, unknownFiles, retired, setups].every(
        (list) => list.length === 0,
      );
    const writer = { writer: this.context.incarnation ?? null };
    // An idle daemon's pump commits each pass: nothing to write takes no write lock (task 001-412).
    if (quiet && !movesWouldChange(store, worktreeId, revision, this.context.now(), writer)) return;
    store.transaction(() => {
      // Before this ledger's first row: what earlier writers left pending (review waves 13ac, 13ad B1).
      const adopts =
        !this.#adopted && adoptsAtFirstCommit(store, worktreeId, this.context.predecessor);
      const before = adopts ? store.testFileKeys.list(worktreeId) : undefined;
      if (rows.length > 0) store.testFileKeys.upsertMany(rows);
      if (removed.length > 0) store.testFileKeys.remove(worktreeId, removed);
      const removedIds = removed.map(testFileId);
      recordRekeyed(store, worktreeId, rekeyed, removedIds);
      // Before this commit's refined revision: refinement caught up only by an earlier commit.
      recordMoves(store, worktreeId, rekeyed, removedIds, revision, this.context.now(), {
        ...writer,
        ...(before === undefined ? {} : { before }),
      });
      for (const { results, checkpointId } of mergeApplied(applied)) {
        sink.applyResults(worktreeId, revision, results, { checkpointId });
      }
      for (const { testFiles, reason } of unknown) {
        sink.markUnknown(worktreeId, revision, testFiles, reason);
      }
      if (unknown.length > 0) {
        store.failures.recordUnknownRuns(worktreeId, revision, unknown, this.context.now());
      }
      if (unknownFiles.length > 0) {
        // An entry stands while its file is still unknown at the key it names.
        recordUnknownFiles(store, worktreeId, unknownFiles, ({ testFile, key }) => {
          const file = this.file(testFile);
          return file !== undefined && file.unknownKey === key && file.key === key;
        });
      }
      if (retired.length > 0) sink.retire(worktreeId, retired);
      for (const { check } of setups)
        store.checks.recordRunner(check, this.context.keys.runnerOf(check.project));
      for (const outcome of setups) sink.setupOutcome(worktreeId, revision, outcome);
      // Only rows that changed: no other file's key, phase or validity moved.
      // Each file is attributed to the checkpoint that requested it (review S9).
      for (const [checkpointId, testFiles] of this.#byCheckpoint(rows)) {
        this.#refresh(revision, checkpointId, testFiles);
      }
      if (options.refined !== undefined) {
        store.meta.set(refinedMetaKey(worktreeId), String(options.refined));
      }
    });
    this.#adopted = true;
  }

  /** Takes what this round of work owes the store and the sink, for `commit`. */
  #drain(): Drained {
    const drained: Drained = {
      dirty: [...this.#dirty],
      removed: this.#removed.splice(0),
      rekeyed: [...this.#rekeyed],
      applied: this.#applied,
      unknown: this.#unknown,
      unknownFiles: this.#unknownFiles,
      retired: this.#retired,
      setups: this.setups.take(),
    };
    this.#dirty.clear();
    this.#rekeyed.clear();
    this.#applied = [];
    this.#unknown = [];
    this.#unknownFiles = [];
    this.#retired = [];
    return drained;
  }

  /**
   * Owes again what a commit that gave up drained (row 011-126), ahead of
   * what came after it, so the next commit writes each once, in order, and a
   * newer entry for the same file or check wins.
   */
  #putBack(drained: Drained): void {
    for (const id of drained.dirty) this.#dirty.add(id);
    this.#removed.unshift(...drained.removed);
    for (const [id, moved] of drained.rekeyed) {
      if (!this.#rekeyed.has(id)) this.#rekeyed.set(id, moved);
    }
    this.#applied = [...drained.applied, ...this.#applied];
    this.#unknown = [...drained.unknown, ...this.#unknown];
    this.#unknownFiles = [...drained.unknownFiles, ...this.#unknownFiles];
    this.#retired = [...drained.retired, ...this.#retired];
    this.setups.putBack(drained.setups);
  }

  /**
   * What a store transaction enclosing work on `refs` would lose if it rolled
   * back after `commit` drained it (review wave-8.1, fourth round): their
   * file states and queue entries, the writes owed and the open checkpoint,
   * as now. The returned function puts them back, so the ledger holds what
   * the store holds and its next commit writes them. Their entries come back
   * exactly, priority, place and promotions included (`RunQueue.hold`, task
   * 004-70).
   */
  hold(refs: Iterable<TestFileRef>): () => void {
    const files = new Map<string, { file: FileState; was: FileState }>();
    for (const ref of refs) {
      const file = this.file(ref);
      if (file === undefined || files.has(file.id)) continue;
      files.set(file.id, { file, was: { ...file, checks: [...file.checks] } });
    }
    const queue = this.queue.hold([...files.values()].map(({ file }) => file.ref));
    const dirty = [...this.#dirty];
    const removed = [...this.#removed];
    const owed = {
      applied: [...this.#applied],
      unknown: [...this.#unknown],
      unknownFiles: [...this.#unknownFiles],
      retired: [...this.#retired],
    };
    const rekeyed = [...this.#rekeyed];
    const adopted = this.#adopted;
    const checkpoints = this.checkpoints.hold();
    return () => {
      for (const { file, was } of files.values()) Object.assign(file, was);
      queue();
      this.#dirty.clear();
      for (const id of dirty) this.#dirty.add(id);
      this.#removed.splice(0, this.#removed.length, ...removed);
      this.#applied = owed.applied;
      this.#unknown = owed.unknown;
      this.#unknownFiles = owed.unknownFiles;
      this.#retired = owed.retired;
      this.#rekeyed.clear();
      for (const [id, moved] of rekeyed) this.#rekeyed.set(id, moved);
      this.#adopted = adopted;
      checkpoints();
    };
  }

  /**
   * `sink.refresh` of `testFiles`. Row 011-72: the files the merge hold holds
   * refresh through a sink that reads no result at their keys, so their
   * checks fall to pending, as with none; the sink, on the validity path
   * (C3), is unchanged.
   */
  #refresh(revision: RevisionNumber, checkpointId: string | null, testFiles: TestFileRef[]): void {
    const { store, worktreeId, sink, now } = this.context;
    const held = testFiles.filter((ref) => this.holds(ref));
    const free = held.length === 0 ? testFiles : testFiles.filter((ref) => !held.includes(ref));
    if (free.length > 0) sink.refresh(worktreeId, revision, { checkpointId }, free);
    if (held.length === 0) return;
    const keys = held.flatMap((ref) => this.file(ref)?.key ?? []);
    sinkWithoutResults(store, new Set(keys), now).refresh(
      worktreeId,
      revision,
      { checkpointId },
      held,
    );
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

  /**
   * The file has a result, or is `unknown`, at its key: its attribution is
   * discharged (task 001-194). The store's records are resolved even with
   * no attribution here: a restarted daemon's files start with none, while
   * a record may hold an edit open (review wave 13v, S1).
   */
  #discharge(file: FileState): void {
    if (!this.#rekeyed.has(file.id)) this.#rekeyed.set(file.id, null);
    clearKeyedAt(file);
  }

  /**
   * Phase follows the queue and the tier in flight; a change is owed to
   * `test_file_keys`. `running` only while the tier runs the file's key: the
   * row is another worktree's claim on that key (task 001-205), and a key an
   * edit moved during the run is not running.
   */
  #syncPhase(file: FileState): void {
    const running = file.runningKey !== null && file.runningKey === file.key;
    const phase = running ? "running" : this.queue.has(file.ref) ? "queued" : null;
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
