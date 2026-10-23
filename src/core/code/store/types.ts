import type {
  CodeCheckId,
  CodeFile,
  CodeKnownState,
  CodeLanguage,
  CodeMeasure,
  CodeOutcome,
  CodeTransition,
  CodeViewEntry,
  FileCount,
} from "../../types/code.js";
import type {
  AbsolutePath,
  Consumer,
  EpochMs,
  FileHash,
  RelativePath,
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

/** Spec 015 D4, D5: the known state of each code check's measures, per worktree. */
export interface CodeStateRepo {
  list(worktreeId: WorktreeId, filter?: CodeStateFilter): readonly CodeKnownState[];
  upsertMany(states: readonly CodeKnownState[]): void;
  /** Removes every measure's state of each check, and every view entry for it. */
  removeMany(worktreeId: WorktreeId, checks: readonly CodeCheckId[]): void;
  /**
   * Spec 015 D2: a move or rename with the same body. `to` takes over
   * `from`'s states and every consumer view's entries for it; `from` keeps
   * none. Nothing is recorded as a transition.
   */
  move(worktreeId: WorktreeId, from: CodeCheckId, to: CodeCheckId): void;
}

/** The audit log of code transitions (011 C5). */
export interface CodeTransitionRepo {
  append(transitions: readonly CodeTransition[]): void;
  /** Oldest first. */
  history(worktreeId: WorktreeId, check: CodeCheckId): readonly CodeTransition[];
}

/** Spec 015 D6: what each consumer was told about each code check, after 011 C5's view. */
export interface CodeViewRepo {
  list(consumer: Consumer): readonly CodeViewEntry[];
  writeMany(consumer: Consumer, entries: readonly CodeViewEntry[]): void;
  /** Every entry of the consumer: it unregistered, or its view is seeded again (D6's summary). */
  clear(consumer: Consumer): void;
}

export interface CodeMetaRepo {
  get(key: string): string | null;
  set(key: string, value: string): void;
  delete(key: string): void;
}

/**
 * What prune keeps (011 C7): every count a live worktree's current file
 * uses, and other counts and coverage records younger than `retentionDays`.
 * Rows of worktrees not in `worktrees` go, and view entries of consumers not
 * in `consumers`; the caller reads both from the main store after its prune.
 */
export interface CodePruneOptions {
  readonly now: EpochMs;
  readonly retentionDays: number;
  readonly worktrees: readonly WorktreeId[];
  readonly consumers: readonly Consumer[];
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
