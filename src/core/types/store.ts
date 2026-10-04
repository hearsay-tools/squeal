import type { CheckId } from "./check.js";
import type { EpochMs, RelativePath, RevisionNumber, WorktreeId } from "./common.js";
import type { Consumer, ViewEntry } from "./delivery.js";
import type { CheckKey, TestFileRef } from "./keys.js";
import type { Revision } from "./revision.js";
import type { RunEnd } from "./runner.js";
import type { KnownState, Transition } from "./state.js";
import type {
  CheckRecord,
  ConsumerRecord,
  DaemonRecord,
  FileHashRecord,
  ResultRecord,
  RunRecord,
  TestFileKeyRecord,
  TestFileRecord,
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
  setDaemon(id: WorktreeId, daemon: DaemonRecord | null): void;
  heartbeat(id: WorktreeId, at: EpochMs): void;
  /** Spec 001 D8: drop "everything owned by removed worktrees". */
  remove(id: WorktreeId): void;
}

export interface RevisionRepo {
  /** Assigns `latest + 1`. Spec 001 D2: "the worktree's **revision** increments by one". */
  append(revision: Omit<Revision, "number">): Revision;
  latest(worktreeId: WorktreeId): Revision | null;
  get(worktreeId: WorktreeId, number: RevisionNumber): Revision | null;
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
  list(worktreeId: WorktreeId): readonly TestFileKeyRecord[];
  upsertMany(records: readonly TestFileKeyRecord[]): void;
  remove(worktreeId: WorktreeId, testFiles: readonly TestFileRef[]): void;
}

export interface CheckRepo {
  listByTestFile(testFile: TestFileRef): readonly CheckRecord[];
  upsertMany(records: readonly CheckRecord[]): void;
}

export interface ResultRepo {
  /**
   * Every result stored under a key. Spec 001 D5: "looks each new key up in
   * the store. A hit is promoted to current for this worktree with its
   * provenance intact."
   */
  byKey(key: CheckKey): readonly ResultRecord[];
  latestForCheck(check: CheckId): ResultRecord | null;
  /** Spec 001 D5: "A result is stored only under a key whose inputs were stable for the whole run." */
  putMany(records: readonly ResultRecord[]): void;
}

export interface RunRepo {
  start(record: Omit<RunRecord, "endedAt" | "end">): RunRecord;
  finish(id: string, end: RunEnd, at: EpochMs): void;
  get(id: string): RunRecord | null;
  /** Newest completed full-suite run of a worktree, for D7. */
  lastFullSuite(worktreeId: WorktreeId): RunRecord | null;
}

/**
 * Persisted known state per worktree and check, written by the daemon after
 * each run or key change and read by hooks and status. Not a table in D8; see
 * `TestFileKeyRecord` for why.
 */
export interface KnownStateRepo {
  list(worktreeId: WorktreeId): readonly KnownState[];
  get(worktreeId: WorktreeId, check: CheckId): KnownState | null;
  upsertMany(states: readonly KnownState[]): void;
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
}

/** Spec 001 D8: "`consumers` and `consumer_views`". */
export interface ViewRepo {
  list(consumer: Consumer): readonly ViewEntry[];
  /** Replaces the given checks' entries. Run in the same transaction as the delta read. */
  writeMany(consumer: Consumer, entries: readonly ViewEntry[]): void;
}

/** Spec 001 D8: "`meta`". Free-form key-value data such as notes for status. */
export interface MetaRepo {
  get(key: string): string | null;
  set(key: string, value: string): void;
}

/** What pruning removed. Spec 001 D8 "Pruning". */
export interface PruneReport {
  readonly resultsRemoved: number;
  readonly runsRemoved: number;
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
  readonly runs: RunRepo;
  readonly knownStates: KnownStateRepo;
  readonly transitions: TransitionRepo;
  readonly consumers: ConsumerRepo;
  readonly views: ViewRepo;
  readonly meta: MetaRepo;

  /** Runs `fn` in one `BEGIN IMMEDIATE` transaction; rolls back if it throws. */
  transaction<T>(fn: () => T): T;

  /**
   * Spec 001 D8: "keep every result whose key is current in any live worktree
   * plus the newest result per check on the main worktree; drop other keys
   * after 7 days and everything owned by removed worktrees; a size cap with
   * LRU eviction as a backstop."
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
