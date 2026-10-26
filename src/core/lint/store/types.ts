import type {
  AbsolutePath,
  CheckKey,
  Consumer,
  EpochMs,
  RelativePath,
  WorktreeId,
} from "../../types/index.js";
import type {
  LintCheckId,
  LintKnownState,
  LintOutcome,
  LintResult,
  LintTransition,
  LintViewEntry,
} from "../../types/lint.js";

/** Spec 017 D5, D6: results by check and key, shared by every worktree. */
export interface LintResultRepo {
  get(check: LintCheckId, key: CheckKey): LintResult | null;
  /** Stores a result. One already stored at its check and key is replaced: a later run is the truer one. */
  put(result: LintResult, at: EpochMs): void;
  /** A worktree took the result by lookup (D7): it is kept as recently used. */
  use(check: LintCheckId, key: CheckKey, at: EpochMs): void;
}

/** Which states `LintStateRepo.list` returns; every field narrows. */
export interface LintStateFilter {
  readonly paths?: readonly RelativePath[];
  readonly outcome?: LintOutcome;
}

/** Spec 017 D6: each worktree's lint states, one per file and tool. */
export interface LintStateRepo {
  list(worktreeId: WorktreeId, filter?: LintStateFilter): readonly LintKnownState[];
  upsertMany(states: readonly LintKnownState[]): void;
  removeMany(worktreeId: WorktreeId, checks: readonly LintCheckId[]): void;
}

/** Spec 017 D2: each worktree's lint transitions, oldest first. */
export interface LintTransitionRepo {
  append(transitions: readonly LintTransition[]): void;
  history(worktreeId: WorktreeId, check: LintCheckId): readonly LintTransition[];
}

/** Spec 017 D8: what each consumer was told, after 015 D6's views. */
export interface LintViewRepo {
  /** The consumer's entries that are not `pass`. */
  list(consumer: Consumer): readonly LintViewEntry[];
  writeMany(consumer: Consumer, entries: readonly LintViewEntry[]): void;
  removeMany(consumer: Consumer, checks: readonly LintCheckId[]): void;
  clear(consumer: Consumer): void;
}

/** Facts of the lint pass that are no check's, by key. */
export interface LintMetaRepo {
  get(key: string): string | null;
  set(key: string, value: string): void;
  delete(key: string): void;
}

/** Spec 017 D6: the lint store, `<common-dir>/squeal/lint.sqlite`. */
export interface LintStore {
  readonly path: AbsolutePath;
  /** `PRAGMA user_version` of the open database. */
  readonly schemaVersion: number;
  readonly meta: LintMetaRepo;
  readonly results: LintResultRepo;
  readonly states: LintStateRepo;
  readonly transitions: LintTransitionRepo;
  readonly views: LintViewRepo;
  /** One `BEGIN IMMEDIATE` write transaction; nested calls are savepoints. */
  transaction<T>(fn: () => T): T;
  /** One read transaction: every statement in `fn` sees one committed state, and nothing is written. */
  read<T>(fn: () => T): T;
  close(): void;
}

/**
 * Why the lint store was not opened. `off`: `lint.enabled` is false, so
 * nothing on disk is touched (goal 1). `missing`: a reader asked not to
 * create it. `newer-schema` and `corrupt` as for the main store (011 C7).
 */
export type LintStoreOpenFailure =
  | { readonly reason: "off" }
  | { readonly reason: "missing" }
  | { readonly reason: "newer-schema"; readonly found: number; readonly supported: number }
  | { readonly reason: "corrupt"; readonly error: string };
