import type { CodeCheckId, CodeLanguage, FileCount } from "../../types/code.js";
import type { CommitSha, FileHash, RelativePath, RevisionNumber } from "../../types/index.js";

/**
 * Spec 015 D3: what the pass counts with. The daemon's is 015-05's
 * `countFile` at its `COUNTER_VERSION` (`counter.ts`); tests inject a fake.
 * A count is stored under the blob the pass read, so the counter sees only
 * the text.
 */
export interface Counter {
  /** `COUNTER_VERSION`: part of every count's key, so a count is never read at another version. */
  readonly version: number;
  count(text: string, language: CodeLanguage): Promise<Pick<FileCount, "functions" | "errors">>;
}

/** One file of the worktree as the main store's stat cache holds it (011 C2, C3). */
export interface SourceFile {
  readonly path: RelativePath;
  /** The git blob id: 011 C3's file hash, the count's key. */
  readonly hash: FileHash;
  readonly size: number;
}

/**
 * What the pass reads from the main store and the scheduler (`source.ts`
 * builds it over a worktree's store). It writes nothing there.
 */
export interface PassSource {
  /** The worktree's newest revision, 0 before the first. */
  latestRevision(): RevisionNumber;
  /** Every path the revisions after `after` up to `upTo` changed, each once. */
  changedPaths(after: RevisionNumber, upTo: RevisionNumber): readonly RelativePath[];
  /** As `changedPaths`, each path with the last of those revisions that changed it (015-39). */
  lastChanges(
    after: RevisionNumber,
    upTo: RevisionNumber,
  ): ReadonlyMap<RelativePath, RevisionNumber>;
  /**
   * 015-19: `HEAD` at `upTo` when a revision after `after` up to `upTo`
   * recorded another `HEAD` than the one before it, as a pull, merge,
   * rebase or checkout does, or when `HEAD` at `after` is not known; `null`
   * when none did, or `HEAD` is unborn.
   */
  movedHead(after: RevisionNumber, upTo: RevisionNumber): CommitSha;
  /** The file at `path` now; `null` when it is gone. */
  file(path: RelativePath): SourceFile | null;
  /** Every file Squeal sees in the worktree. */
  files(): readonly SourceFile[];
  /** D1: test files, any file a runner lists. Never counted. */
  testFiles(): readonly RelativePath[];
  /** D1: files git ignores that Squeal watches anyway (a closure reads them). Never counted. */
  ignored(): readonly RelativePath[];
}

/**
 * Why a pass rebuilt every state instead of following the revisions (spec
 * 015 D1, D6): `first`, the worktree's first count or the policy switched
 * on; `threshold`, `include` (include, exclude or `maxFileBytes`) and
 * `counter` (a new `COUNTER_VERSION`), a policy change.
 */
export type RecountReason = "first" | "threshold" | "include" | "counter";

/**
 * Code meta `recount:<worktreeId>` (the coordinator's contract with 015-07):
 * the last recount that delivers one summary line instead of transitions.
 */
export interface RecountRecord {
  readonly revision: RevisionNumber;
  readonly at: number;
  readonly reason: RecountReason;
  readonly threshold: number;
}

/** What one pass did, for the daemon's log and 015-08. */
export interface PassReport {
  /** The revision its states are counted at. */
  readonly revision: RevisionNumber;
  /** `edit` follows the revisions; the others rebuild every state with no transition. */
  readonly mode: "edit" | RecountReason;
  /** Files whose state it read again. */
  readonly files: number;
  /** Blobs it counted; every other one was in the store already. */
  readonly counted: number;
  /** Code transitions it recorded. */
  readonly transitions: number;
  /** Moves and renames by body hash (D2). */
  readonly moved: number;
  /** Those moves, each check's old identity and its new one (row 015-47, review 0.1.311 B1). */
  readonly moves: readonly { readonly from: CodeCheckId; readonly to: CodeCheckId }[];
  /** The checks it removed, moves aside (row 015-47, review 0.1.311 B1). */
  readonly removed: readonly CodeCheckId[];
  /**
   * D6's last rule (015-08): checks whose identity stayed and whose body
   * hash changed, stored on their states (`CodeStateRepo.markEdited`). Not
   * those of a file a move of `HEAD` brought as committed (015-19).
   */
  readonly edited: readonly CodeCheckId[];
}
