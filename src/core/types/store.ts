import type { CheckId, SetupCheckId } from "./check.js";
import type { CommitSha, EpochMs, RelativePath, RevisionNumber, WorktreeId } from "./common.js";
import type { Consumer, ViewEntry } from "./delivery.js";
import type { CheckKey, TestFileRef } from "./keys.js";
import type { Revision } from "./revision.js";
import type { RunEnd } from "./runner.js";
import type { KnownState, Transition } from "./state.js";
import type {
  CheckpointEnd,
  CheckpointRecord,
  CheckRecord,
  ConsumerRecord,
  DaemonRecord,
  FailingRow,
  FailureText,
  FileHashRecord,
  MarkedUnknown,
  ReplacedFailure,
  ResultRecord,
  RunRecord,
  TestFileKeyRecord,
  TestFileRecord,
  UnknownRun,
  WorktreeRecord,
} from "./store-records.js";

/*
 * Store access. Spec 001 D8: "SQLite through `node:sqlite` [...] WAL mode,
 * `synchronous=NORMAL`, a busy timeout on every connection, short `BEGIN
 * IMMEDIATE` write transactions, schema version in `user_version` with
 * transactional migrations."
 *
 * Every method is synchronous because `node:sqlite` is. Hook scripts run on a
 * 2 s budget and need no event-loop turns for a read.
 */

export interface WorktreeRepo {
  get(id: WorktreeId): WorktreeRecord | null;
  list(): readonly WorktreeRecord[];
  upsert(record: WorktreeRecord): void;
  /** `null` clears the daemon and keeps its last heartbeat as `lastHeartbeatAt`. */
  setDaemon(id: WorktreeId, daemon: DaemonRecord | null): void;
  heartbeat(id: WorktreeId, at: EpochMs): void;
  /**
   * The identity of the daemon that registered last, running or not: its
   * start time, version and start token (`DaemonRecord.token`), which a
   * clean exit keeps (D10). `null` with no row, or with no start time (a
   * release whose exit cleared it).
   */
  lastDaemon(id: WorktreeId): {
    readonly startedAt: EpochMs;
    readonly squealVersion: string | null;
    readonly token?: string;
  } | null;
  /**
   * Spec 001 D8: the rows that belong to the worktree go; its results and
   * their runs stay for prune's 7-day cutoff (row 011-160).
   */
  remove(id: WorktreeId): void;
}

export interface RevisionRepo {
  /** Assigns `latest + 1`. Spec 001 D2: "the worktree's **revision** increments by one". */
  append(revision: Omit<Revision, "number">): Revision;
  latest(worktreeId: WorktreeId): Revision | null;
  get(worktreeId: WorktreeId, number: RevisionNumber): Revision | null;
  /**
   * The newest revision recorded at a `HEAD` other than `head`, so the ones
   * after it share `head` (task 001-406); `null` when every one does.
   */
  lastAtOtherHead(worktreeId: WorktreeId, head: CommitSha): RevisionNumber | null;
  /** Revisions numbered after `after` up to `upTo`, oldest first, in one query (review wave 10b, N3). */
  range(worktreeId: WorktreeId, after: RevisionNumber, upTo: RevisionNumber): readonly Revision[];
}

export interface FileHashRepo {
  get(worktreeId: WorktreeId, path: RelativePath): FileHashRecord | null;
  list(worktreeId: WorktreeId): readonly FileHashRecord[];
  upsertMany(worktreeId: WorktreeId, records: readonly FileHashRecord[]): void;
  removeMany(worktreeId: WorktreeId, paths: readonly RelativePath[]): void;
}

export interface TestFileRepo {
  get(testFile: TestFileRef): TestFileRecord | null;
  list(): readonly TestFileRecord[];
  put(record: TestFileRecord): void;
  remove(testFile: TestFileRef): void;
}

/** Per-worktree current keys and pending work. See `TestFileKeyRecord`. */
export interface TestFileKeyRepo {
  /** With `files`, only their rows (task 001-414). */
  list(worktreeId: WorktreeId, files?: readonly TestFileRef[]): readonly TestFileKeyRecord[];
  /** Rows of every worktree whose key is `key` (task 001-170: a pass heals each of them). */
  withKey(key: CheckKey): readonly TestFileKeyRecord[];
  upsertMany(records: readonly TestFileKeyRecord[]): void;
  remove(worktreeId: WorktreeId, testFiles: readonly TestFileRef[]): void;
  /** Spec 001 D10 as amended (task 001-205): a starting daemon's leftover `running` rows become `queued`. */
  releaseRunning(worktreeId: WorktreeId): void;
  /**
   * Spec 001 D8 as amended (task 001-205): another worktree whose daemon is
   * `live` holds a row at `key` with `pending = 'running'`, its claim on the
   * key. Derived, so nothing is written to take or release a claim.
   */
  claimed(worktreeId: WorktreeId, key: CheckKey, live: Liveness): boolean;
  /**
   * How many other worktrees whose daemon is `live` hold a queued or running
   * row at a key `worktreeId` has queued: the daemons a backlog is split
   * with (D5 step 5 as amended, task 001-205).
   */
  sharers(worktreeId: WorktreeId, live: Liveness): number;
}

/** A daemon is live while its heartbeat is at most `graceIntervals` of its intervals before `now`. */
export interface Liveness {
  readonly now: EpochMs;
  readonly graceIntervals: number;
}

export interface CheckRepo {
  listByTestFile(testFile: TestFileRef): readonly CheckRecord[];
  upsertMany(records: readonly CheckRecord[]): void;
  /**
   * The runner recorded with `check`'s result at `key` (spec 016 D3): the one
   * whose run stored it. `null` when there is no such result, or an older
   * daemon stored it. Checks are shared by every worktree, so a worktree
   * reads the result its own state shows (review 0.1.303 B1).
   */
  runnerOf(check: CheckId, key: CheckKey): string | null;
  /**
   * The runner `worktreeId` recorded with setup check `check`
   * (`recordSetupRunner`); `null` when none.
   */
  setupRunnerOf(worktreeId: WorktreeId, check: SetupCheckId): string | null;
  /**
   * Records `runner` with `worktreeId`'s setup check `check`, which has no
   * stored result (001-382). Another worktree's record is never read.
   * `undefined` forgets it.
   */
  recordSetupRunner(worktreeId: WorktreeId, check: SetupCheckId, runner: string | undefined): void;
  /**
   * Records nothing. `Ledger#write` still calls it until the next commit moves
   * that line to `recordSetupRunner`, which keeps ledger.ts alone.
   */
  recordRunner(check: CheckId, runner: string | undefined): void;
}

/** Which stored failures `squeal failures` reads (task 001-409). */
export interface FailureFilter {
  /** Only results this worktree produced; `null` for every worktree. */
  readonly worktreeId: WorktreeId | null;
  /** Only results recorded at or after this time; `null` for any time. */
  readonly since: EpochMs | null;
}

/**
 * Which stored failures `squeal failures` reads (row 011-75, spec 011 C6 as
 * amended 2026-10-21 for 011-64). Each field narrows the rows; a failure
 * matches when it passes every one.
 */
export interface FailureSelection {
  /** Only results this worktree produced; `null` for every worktree. */
  readonly worktreeId: WorktreeId | null;
  /** Only results recorded at or after this time; `null` for any time. */
  readonly since: EpochMs | null;
  /**
   * Root-relative test files or directories; a check matches when its test
   * path is one of them or lies below one. Empty for every path.
   */
  readonly paths: readonly RelativePath[];
  /** Only these checks' failures (`FailureRepo.failingChecks`); `null` for every check. */
  readonly checks: readonly CheckId[] | null;
  /** Only failures whose summary holds one of these texts (`--error`); absent or empty for every error. */
  readonly errors?: readonly string[];
  /**
   * Only each check's newest failure among those the rest selects
   * (`--per-check`), so a count counts checks. Absent means every failure.
   */
  readonly perCheck?: boolean;
}

/**
 * Failure evidence beside `results`: the stored failing rows, read through
 * `results_by_failure` (row 011-75), the replaced failures (row 011-77) and
 * the runs behind UNKNOWN states (row 011-108). Off the key-format alarm's
 * path, unlike `ResultRepo` (011-64, section 4).
 */
export interface FailureRepo {
  /** Failing results of `selection`, newest first by record time, at most `limit`. Read only. */
  list(selection: FailureSelection, limit: number): readonly ResultRecord[];
  /** How many failing results match `selection`, for "newest N of M". */
  count(selection: FailureSelection): number;
  /** The checks with a failing result matching `selection`, sorted; a `--check` text is matched against their printed names. */
  failingChecks(selection: FailureSelection): readonly CheckId[];
  /** The failing rows at `key` with their failure texts' ids, read before a run's results replace them (row 011-77). */
  failingAt(key: CheckKey): readonly FailingRow[];
  /**
   * Keeps each of `failing`, the rows at a key before `records` were stored
   * there, that a pass in `records` replaced, with the load per CPU `loadOf`
   * gives its run (row 011-77). Inside the caller's transaction. Returns how
   * many it kept.
   */
  keepReplaced(
    failing: readonly FailingRow[],
    records: readonly ResultRecord[],
    loadOf: (runId: string) => number | null,
  ): number;
  /** Every kept replaced failure, oldest first; empty when none or unreadable. */
  replaced(): readonly ReplacedFailure[];
  /** A stored failure text; `null` when it was pruned. */
  text(failureId: string): FailureText | null;
  /**
   * Records the run behind each file `marked` made UNKNOWN at `revision`,
   * over the file's earlier record (row 011-108). Inside the commit that
   * marks them.
   */
  recordUnknownRuns(
    worktreeId: WorktreeId,
    revision: RevisionNumber,
    marked: readonly MarkedUnknown[],
    at: EpochMs,
  ): void;
  /** `worktreeId`'s records of the runs behind its UNKNOWN states; empty when none or unreadable. */
  unknownRuns(worktreeId: WorktreeId): readonly UnknownRun[];
}

/** A key with results, and when its newest one was recorded (`ResultRepo.keysSince`). */
export interface StoredKey {
  readonly key: CheckKey;
  readonly recordedAt: EpochMs;
}

export interface ResultRepo {
  /**
   * Every result stored under a key. Spec 001 D5: "looks each new key up in
   * the store. A hit is promoted to current for this worktree with its
   * provenance intact."
   *
   * Every hit advances the results' last-used time to `usedAt`, never back.
   * Spec 001 D8: "with a last-used time advanced on every lookup hit"; the
   * size cap evicts by it. A `null` key (an unkeyed test file) has no results.
   * `usedAt` 0 is a read, not a hit: it writes nothing, so it runs in a read
   * transaction beside a writer (011-01, issue 7: the no-row UPDATE upgraded
   * `why`'s read and failed at once).
   */
  byKey(key: CheckKey | null, usedAt?: EpochMs): readonly ResultRecord[];
  /**
   * The checks with a result under a key, sorted. Spec 001 D8: "the
   * file-level error expansion uses the checks of the file's previous key,
   * never every check ever seen."
   */
  checksForKey(key: CheckKey): readonly CheckId[];
  latestForCheck(check: CheckId): ResultRecord | null;
  /**
   * Results of one test file under the key of its newest result, from any
   * worktree; empty when it has none. When rows of the file share the newest
   * record time, the one stored last (the greater `rowid`) names the key, as
   * in `listForCheck` and prune. Read only, as `listForCheck`. Row 011-154: a
   * miss with no previous key takes its last duration from them.
   */
  newestForTestFile(testFile: TestFileRef): readonly ResultRecord[];
  /**
   * Results of one check under any key, from every worktree, newest first by
   * record time, at most `limit`. Read only: never advances the last-used
   * time. Spec 001 D7: "`squeal why <check>` prints the full history and
   * provenance of one check".
   */
  listForCheck(check: CheckId, limit: number): readonly ResultRecord[];
  /**
   * Stored `fail` results matching `filter`, newest first by record time, at
   * most `limit`. Read only, as `listForCheck`. Task 001-409, `squeal failures`.
   */
  listFailures(filter: FailureFilter, limit: number): readonly ResultRecord[];
  /** How many stored `fail` results match `filter`, for the cap's "first N of M". */
  countFailures(filter: FailureFilter): number;
  /**
   * Each key with a result recorded after `since`, with its newest record
   * time (`results_by_time`). Read only, as `listForCheck`. Spec 011 C4 step 3
   * as amended 2026-10-20 (task 011-23): the keys other worktrees stored
   * since a worktree last read.
   */
  keysSince(since: EpochMs): readonly StoredKey[];
  /**
   * Copies the newest set stored under one of `from` (by its newest record
   * time) to `key`, each row with its provenance and record time, only while
   * `key` holds no row; true when it copied one. A miss among `from` reads
   * and writes nothing. Spec 011 C7 as amended 2026-10-20 (task 011-38): a
   * set copied from a format read as one "is written only under a key that
   * holds no row, so it never replaces a stored set or mixes with one".
   */
  copyNewest(key: CheckKey, from: readonly CheckKey[]): boolean;
  /**
   * Spec 001 D5: "A result is stored only under a key whose inputs were
   * stable for the whole run." A stored result's last-used time starts at
   * `provenance.recordedAt`. `runner`, the runner whose run produced them,
   * is recorded with each row (`CheckRepo.runnerOf`, spec 016 D3); absent,
   * the rows record none.
   */
  putMany(records: readonly ResultRecord[], runner?: string): void;
}

export interface RunRepo {
  start(record: Omit<RunRecord, "endedAt" | "end">): RunRecord;
  finish(id: string, end: RunEnd, at: EpochMs): void;
  get(id: string): RunRecord | null;
  /**
   * The worktree's runs with no end started at or after `startedSince`,
   * oldest first: what a daemon that started then was running when it died
   * (task 001-263).
   */
  inFlight(worktreeId: WorktreeId, startedSince: EpochMs): readonly RunRecord[];
}

/** Spec 001 D8: "`checkpoints` (one per `run --all` or baseline request, referenced by its tier runs)". */
export interface CheckpointRepo {
  start(record: Omit<CheckpointRecord, "completedAt" | "end">): CheckpointRecord;
  finish(id: string, end: CheckpointEnd, at: EpochMs): void;
  get(id: string): CheckpointRecord | null;
  /** Newest `completed` checkpoint of a worktree, a one-lane one included. */
  lastCompleted(worktreeId: WorktreeId): CheckpointRecord | null;
  /**
   * Newest `completed` checkpoint of a worktree that requested both lanes.
   * Spec 001 D7: "whether a full-suite checkpoint completed for this
   * revision and at which revision the last one completed"; a one-lane
   * checkpoint is none (task 004-61).
   */
  lastCompletedFull(worktreeId: WorktreeId): CheckpointRecord | null;
}

/**
 * Persisted known state per worktree and check, written by the daemon after
 * each run or key change and read by hooks and status. Not a table in D8; see
 * `TestFileKeyRecord` for why.
 */
export interface KnownStateRepo {
  /** With `files`, only their checks' states (task 001-414). */
  list(worktreeId: WorktreeId, files?: readonly TestFileRef[]): readonly KnownState[];
  /** The worktree's states with no entry in `consumer`'s view: what it was never told. */
  untold(consumer: Consumer): readonly KnownState[];
  get(worktreeId: WorktreeId, check: CheckId): KnownState | null;
  upsertMany(states: readonly KnownState[]): void;
  /**
   * Spec 001 D8: "Checks that disappear from a test file are retired from
   * `known_states` and every consumer view". Unknown checks are ignored.
   */
  removeMany(worktreeId: WorktreeId, checks: readonly CheckId[]): void;
}

export interface TransitionRepo {
  append(transitions: readonly Transition[]): void;
  /** Spec 001 D7: "`squeal why <check>` prints the full history". */
  history(worktreeId: WorktreeId, check: CheckId): readonly Transition[];
}

export interface ConsumerRepo {
  get(consumer: Consumer): ConsumerRecord | null;
  list(worktreeId: WorktreeId): readonly ConsumerRecord[];
  register(consumer: Consumer, at: EpochMs): ConsumerRecord;
  touch(consumer: Consumer, at: EpochMs, delivered: boolean): void;
  unregister(consumer: Consumer): void;
  /** Removes consumers idle since before `cutoff`; returns them. */
  expire(cutoff: EpochMs): readonly Consumer[];
  /** Consumers idle since before `cutoff`, in every worktree: neither heard from nor delivered to. */
  idleSince(cutoff: EpochMs): readonly ConsumerRecord[];
}

/** Spec 001 D8: "`consumers` and `consumer_views`". */
export interface ViewRepo {
  /** With `files`, only their checks' entries (task 001-414). */
  list(consumer: Consumer, files?: readonly TestFileRef[]): readonly ViewEntry[];
  /** Replaces the given checks' entries. Run in the same transaction as the delta read. */
  writeMany(consumer: Consumer, entries: readonly ViewEntry[]): void;
  /** Retires checks from this consumer's view; see `KnownStateRepo.removeMany`. */
  removeMany(consumer: Consumer, checks: readonly CheckId[]): void;
}

/** Spec 001 D8: "`meta`". Free-form key-value data such as notes for status. */
export interface MetaRepo {
  get(key: string): string | null;
  set(key: string, value: string): void;
  /** Removes the row; a missing key is a no-op. */
  delete(key: string): void;
}

/**
 * Every `meta` row named `<prefix><worktreeId>`, by row: its prefix and the
 * module under `src/core` that reads and writes it (task 001-254). A row
 * belongs to its worktree and goes with it (`WorktreeRepo.remove`). Rows
 * shared across worktrees, such as `flaky-checks` or a node:test
 * observation's, are not listed.
 */
export const WORKTREE_META_ROWS = {
  turn: { prefix: "turn:", owner: "delivery/turn" },
  edits: { prefix: "edits:", owner: "delivery/edits" },
  harnessProcess: { prefix: "harness-process:", owner: "delivery/harness-process" },
  departed: { prefix: "departed:", owner: "delivery/expiry" },
  consumerVersion: { prefix: "consumer-version:", owner: "delivery/consumer-version" },
  registered: { prefix: "revision-registered:", owner: "delivery/registered" },
  registeredLeft: { prefix: "revision-registered-left:", owner: "delivery/registered" },
  registeredKeys: { prefix: "registered-keys:", owner: "state/before-edits" },
  livenessTold: { prefix: "liveness-told:", owner: "delivery/liveness" },
  revisionTold: { prefix: "revision-told:", owner: "delivery/liveness" },
  uncoveredTold: { prefix: "uncovered-told:", owner: "delivery/uncovered" },
  slowTierTold: { prefix: "slow-tier-told:", owner: "delivery/slow-told" },
  holdTold: { prefix: "hold-told:", owner: "delivery/hold-told" },
  leaving: { prefix: "leaving:", owner: "delivery/leaving" },
  notes: { prefix: "notes.", owner: "types/scheduler" },
  refined: { prefix: "refined.", owner: "types/scheduler" },
  awaitingInstall: { prefix: "awaiting-install.", owner: "types/scheduler" },
  installCommand: { prefix: "install-command.", owner: "types/scheduler" },
  checkpoint: { prefix: "checkpoint.", owner: "types/scheduler" },
  checkpointLanes: { prefix: "checkpoint-lanes.", owner: "store/repos/runs" },
  headMove: { prefix: "head-move.", owner: "types/scheduler" },
  feedDelivered: { prefix: "feed-delivered:", owner: "status/feed-late" },
  daemonBootstrapped: { prefix: "daemon-bootstrapped:", owner: "types/daemon" },
  daemonToken: { prefix: "daemon-token:", owner: "store/repos/worktrees" },
  daemonExit: { prefix: "daemon-exit:", owner: "types/daemon" },
  daemonRest: { prefix: "daemon-rest:", owner: "types/daemon" },
  daemonUsed: { prefix: "daemon-used:", owner: "daemon/last-use" },
  daemonStopped: { prefix: "daemon-stopped:", owner: "delivery/stopped" },
  daemonHandoff: { prefix: "daemon-handoff:", owner: "delivery/handoff" },
  daemonHandoffShort: { prefix: "daemon-handoff-short:", owner: "delivery/handoff" },
  slowTier: { prefix: "slow-tier:", owner: "slow/state" },
  slowEvidence: { prefix: "slow-evidence:", owner: "slow/rank-store" },
  failureKeys: { prefix: "failure-keys:", owner: "slow/state" },
  failureProducers: { prefix: "failure-producers:", owner: "state/producers" },
  setupRunners: { prefix: "setup-runners:", owner: "store/repos/test-files" },
  reruns: { prefix: "reruns:", owner: "scheduler/rerun-memory" },
  interrupted: { prefix: "interrupted:", owner: "scheduler/interrupted" },
  heldFiles: { prefix: "held-files:", owner: "scheduler/held" },
  promotions: { prefix: "promotions:", owner: "scheduler/promotions" },
  focused: { prefix: "focused:", owner: "scheduler/focused-row" },
  yields: { prefix: "yields:", owner: "scheduler/yields" },
  quiet: { prefix: "quiet:", owner: "scheduler/quiet" },
  mergeHold: { prefix: "merge-hold:", owner: "scheduler/hold-rows" },
  commandHold: { prefix: "command-hold:", owner: "scheduler/hold-rows" },
  rekeyed: { prefix: "rekeyed.", owner: "scheduler/rekeyed-record" },
  rekeyedMoves: { prefix: "rekeyed-moves.", owner: "scheduler/rekeyed-moves" },
  optimizerOff: { prefix: "optimizer-off.", owner: "state/optimizer-note" },
  baselineFindings: { prefix: "state.baseline-findings.", owner: "state/baseline" },
  stopWait: { prefix: "stop-wait:", owner: "slow/stop-wait" },
  testCommandDenied: { prefix: "test-command-denied:", owner: "delivery/test-command-denied" },
  ignoredReads: { prefix: "ignored-reads:", owner: "scheduler/ignored-reads" },
  omittedTestFiles: { prefix: "omitted-test-files:", owner: "scheduler/omitted-test-files" },
  unknownFiles: { prefix: "unknown-files:", owner: "scheduler/unknown-files" },
} as const;

export type WorktreeMetaRow = keyof typeof WORKTREE_META_ROWS;

/** The `meta` key of `worktreeId`'s `row`. */
export function worktreeMetaKey(row: WorktreeMetaRow, worktreeId: WorktreeId): string {
  return `${WORKTREE_META_ROWS[row].prefix}${worktreeId}`;
}

/** What pruning removed. Spec 001 D8 "Pruning". */
export interface PruneReport {
  readonly resultsRemoved: number;
  readonly runsRemoved: number;
  readonly checkpointsRemoved: number;
  /** `checks` rows no result, known state, view or transition referenced any more. */
  readonly checksRemoved: number;
  readonly worktreesRemoved: number;
  readonly bytesAfter: number;
}

export interface PruneOptions {
  readonly now: EpochMs;
  readonly retentionDays: number;
  readonly maxSizeMb: number | null;
}

/** One open connection to `<git-common-dir>/squeal/store.sqlite`. */
export interface Store {
  /** `PRAGMA user_version` of the open database. */
  readonly schemaVersion: number;

  readonly worktrees: WorktreeRepo;
  readonly revisions: RevisionRepo;
  readonly fileHashes: FileHashRepo;
  readonly testFiles: TestFileRepo;
  readonly testFileKeys: TestFileKeyRepo;
  readonly checks: CheckRepo;
  readonly results: ResultRepo;
  readonly failures: FailureRepo;
  readonly runs: RunRepo;
  readonly checkpoints: CheckpointRepo;
  readonly knownStates: KnownStateRepo;
  readonly transitions: TransitionRepo;
  readonly consumers: ConsumerRepo;
  readonly views: ViewRepo;
  readonly meta: MetaRepo;

  /** Runs `fn` in one `BEGIN IMMEDIATE` transaction; rolls back if it throws. */
  transaction<T>(fn: () => T): T;

  /**
   * Spec 001 D8 as amended 2026-10-23: "keep every result whose key is
   * current in any live worktree plus the newest result per check on the main
   * worktree; drop other keys after 7 days, the results of removed worktrees
   * included [...]; a size cap evicting least recently used results as a
   * backstop."
   */
  prune(options: PruneOptions): PruneReport;

  close(): void;
}

/**
 * Why a store could not be opened.
 *
 * Spec 001 D8: "A daemon that finds a `user_version` newer than it
 * understands exits". D12: "Store unreadable or corrupt: `integrity_check` on
 * daemon start; on failure the file is moved aside".
 */
export type StoreOpenFailure =
  | { readonly reason: "missing" }
  | { readonly reason: "newer-schema"; readonly found: number; readonly supported: number }
  | { readonly reason: "corrupt"; readonly movedTo: string | null };
