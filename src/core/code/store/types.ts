import type {
  CodeCheckId,
  CodeFile,
  CodeKnownState,
  CodeLanguage,
  CodeMeasure,
  CodeOutcome,
  CodeTransition,
  CodeViewEntry,
  CoverageRecordKey,
  FileCount,
} from "../../types/code.js";
import type {
  AbsolutePath,
  CheckKey,
  Consumer,
  EpochMs,
  FileHash,
  RelativePath,
  RevisionNumber,
  WorktreeId,
} from "../../types/index.js";

/** Spec 015 D4: counts by `(blob, language, counter version)`, shared by every worktree. */
export interface CodeCountRepo {
  get(blob: FileHash, language: CodeLanguage, counterVersion: number): FileCount | null;
  /** Stores a count. A count already stored under its key stays: the same bytes count the same. */
  put(count: FileCount, at: EpochMs): void;
}

/** Each worktree's included files at its current revision (spec 015 D4). */
export interface CodeFileRepo {
  list(worktreeId: WorktreeId, paths?: readonly RelativePath[]): readonly CodeFile[];
  /**
   * The files whose count is not stored yet: the first count's work, and
   * status's "counting: N of M". A too-big file is never among them.
   */
  uncounted(worktreeId: WorktreeId): readonly CodeFile[];
  upsertMany(worktreeId: WorktreeId, files: readonly CodeFile[]): void;
  removeMany(worktreeId: WorktreeId, paths: readonly RelativePath[]): void;
}

/** Which states `CodeStateRepo.list` returns; every field narrows. */
export interface CodeStateFilter {
  readonly paths?: readonly RelativePath[];
  readonly measure?: CodeMeasure;
  readonly outcome?: CodeOutcome;
}

/**
 * Spec 015 D6, its last rule: the last revision a check's body changed with
 * its identity kept, and when the pass stored it, for a view's `toldAt`.
 */
export interface CodeEdit {
  readonly check: CodeCheckId;
  readonly measure: CodeMeasure;
  readonly revision: RevisionNumber;
  readonly at: EpochMs;
}

/** Spec 015 D4, D5: the known state of each code check's measures, per worktree. */
export interface CodeStateRepo {
  list(worktreeId: WorktreeId, filter?: CodeStateFilter): readonly CodeKnownState[];
  /** Writes each state; a stored state keeps its last edit. */
  upsertMany(states: readonly CodeKnownState[]): void;
  /** The last edit of each state of `measure` that has one; with `paths`, of theirs (row 015-45). */
  edits(
    worktreeId: WorktreeId,
    measure: CodeMeasure,
    paths?: readonly RelativePath[],
  ): readonly CodeEdit[];
  /** Records each edit on its check's state; one with no state of that measure is skipped. */
  markEdited(worktreeId: WorktreeId, edits: readonly CodeEdit[]): void;
  /**
   * Removes every measure's state of each check. View entries stay: a
   * consumer told `fail` is told once that the function is no longer in the
   * code (D2), then the delivery removes the entry (`CodeViewRepo.removeMany`).
   */
  removeMany(worktreeId: WorktreeId, checks: readonly CodeCheckId[]): void;
  /** Every check's state of `measure`: `coverage.enabled` went off, so D9's states go (row 015-12). */
  removeMeasure(worktreeId: WorktreeId, measure: CodeMeasure): void;
  /**
   * Spec 015 D2: a move or rename with the same body. `to` takes over
   * `from`'s states, every consumer view's entries for it and its
   * transitions, at their own revision and time, in one transaction; `from`
   * keeps none, and what `to` held before is dropped. Nothing new is recorded
   * as a transition.
   */
  move(worktreeId: WorktreeId, from: CodeCheckId, to: CodeCheckId): void;
  /**
   * Row 015-48: a pass's states, staged in parts under `staged`, take the
   * worktree's place in one transaction. Each `measure` state staged is
   * written over the worktree's, keeping its last edit as `upsertMany` does,
   * and every measure's state of each `removed` check goes. The staged rows
   * stay. Returns the number of states written: fewer than were staged when
   * a prune took some.
   */
  adopt(
    worktreeId: WorktreeId,
    staged: WorktreeId,
    measure: CodeMeasure,
    removed: readonly CodeCheckId[],
  ): number;
}

/** The audit log of code transitions (011 C5). */
export interface CodeTransitionRepo {
  append(transitions: readonly CodeTransition[]): void;
  /** Oldest first. */
  history(worktreeId: WorktreeId, check: CodeCheckId): readonly CodeTransition[];
}

/**
 * Spec 015 D6: what each consumer was told about each code check, after 011
 * C5's view. A view holds the functions told failing only: a check with no
 * entry reads `pass` (lessons round 1, P5).
 */
export interface CodeViewRepo {
  /** The consumer's entries; a `pass` entry an older hook wrote reads as none. */
  list(consumer: Consumer): readonly CodeViewEntry[];
  writeMany(consumer: Consumer, entries: readonly CodeViewEntry[]): void;
  /** The consumer's entries of these checks and measures; others stay. */
  removeMany(
    consumer: Consumer,
    entries: readonly Pick<CodeViewEntry, "check" | "measure">[],
  ): void;
  /** Every entry of the consumer: it unregistered, or its view is seeded again (D6's summary). */
  clear(consumer: Consumer): void;
  /** Removes the entries in `worktreeIds` of every consumer not in `consumers`; returns how many went. */
  retain(worktreeIds: readonly WorktreeId[], consumers: readonly Consumer[]): number;
}

/**
 * Spec 015 D8: one coverage record per test file result, the encoded bytes
 * (`encodeRecord`, `src/core/code/coverage/record.ts`), at the result's key
 * and the provider's version.
 */
export interface CodeCoverageRepo {
  get(key: CoverageRecordKey): Uint8Array | null;
  /** Whether a record is stored at `key`; a read that inflates nothing (row 015-12). */
  has(key: CoverageRecordKey): boolean;
  /**
   * When the record at `key` was stored, read without its blob; each record
   * stored at a key has its own (row 015-44). `null` when none is.
   */
  storedAt(key: CoverageRecordKey): EpochMs | null;
  /** Stores a record, over one at the same key: a rerun at a key replaces its result too. */
  put(key: CoverageRecordKey, record: Uint8Array, at: EpochMs): void;
}

export interface CodeMetaRepo {
  get(key: string): string | null;
  set(key: string, value: string): void;
  delete(key: string): void;
}

/**
 * What prune keeps (011 C7): every count a live worktree's current file
 * uses, and other counts younger than `retentionDays`; a coverage record
 * while a result is at its key (`resultKeys`). Rows of worktrees not in
 * `worktrees` go, and view entries of consumers not in `consumers`; the
 * caller reads these lists from the main store after its prune.
 */
export interface CodePruneOptions {
  readonly now: EpochMs;
  readonly retentionDays: number;
  readonly worktrees: readonly WorktreeId[];
  readonly consumers: readonly Consumer[];
  /**
   * Every key the main store holds a result at (row 015-11). Absent, a
   * coverage record goes by age, as a count does.
   */
  readonly resultKeys?: readonly CheckKey[];
}

export interface CodePruneReport {
  readonly countsRemoved: number;
  readonly coverageRemoved: number;
  readonly worktreesRemoved: number;
  readonly viewsRemoved: number;
  readonly checksRemoved: number;
}

/** One open connection to `<git-common-dir>/squeal/code.sqlite` (spec 015 D4). */
export interface CodeStore {
  readonly path: AbsolutePath;
  /** `PRAGMA user_version` of the open database. */
  readonly schemaVersion: number;
  readonly meta: CodeMetaRepo;
  readonly counts: CodeCountRepo;
  readonly files: CodeFileRepo;
  readonly states: CodeStateRepo;
  readonly transitions: CodeTransitionRepo;
  readonly views: CodeViewRepo;
  readonly coverage: CodeCoverageRepo;
  /** One `BEGIN IMMEDIATE` write transaction; nested calls are savepoints. */
  transaction<T>(fn: () => T): T;
  /** One read transaction: every statement in `fn` sees one committed state, and nothing is written. */
  read<T>(fn: () => T): T;
  prune(options: CodePruneOptions): CodePruneReport;
  close(): void;
}

/**
 * Why the code store was not opened. `off`: `complexity.enabled` is false, so
 * nothing on disk is touched (goal 1). `missing`: a reader asked not to
 * create it. `newer-schema` and `corrupt` as for the main store (011 C7).
 */
export type CodeStoreOpenFailure =
  | { readonly reason: "off" }
  | { readonly reason: "missing" }
  | { readonly reason: "newer-schema"; readonly found: number; readonly supported: number }
  | { readonly reason: "corrupt"; readonly error: string };
