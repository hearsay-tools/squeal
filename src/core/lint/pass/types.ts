import type {
  AbsolutePath,
  EpochMs,
  FileHash,
  Policy,
  RelativePath,
  RevisionNumber,
  WorktreeId,
} from "../../types/index.js";
import type { LintProvider } from "./provider.js";

/** One file of the worktree as the main store's stat cache holds it (011 C2, C3). */
export interface LintSourceFile {
  readonly path: RelativePath;
  /** The git blob id: the file's part of its key (D5). */
  readonly hash: FileHash;
}

/**
 * What the pass reads from the main store and the scheduler. The code pass's
 * `mainStoreSource` gives it (015 D4); it writes nothing there.
 */
export interface LintSource {
  /** The worktree's newest revision, 0 before the first. */
  latestRevision(): RevisionNumber;
  /** Every path the revisions after `after` up to `upTo` changed, each once. */
  changedPaths(after: RevisionNumber, upTo: RevisionNumber): readonly RelativePath[];
  /** The file at `path` now; `null` when it is gone. */
  file(path: RelativePath): LintSourceFile | null;
  /** Every file Squeal sees in the worktree. */
  files(): readonly LintSourceFile[];
  /** Files git ignores that Squeal watches anyway. Never linted. */
  ignored(): readonly RelativePath[];
}

/** The capacity pool's side the pass uses (011 C10): the scheduler's `TierCapacity`. */
export type { TierCapacity as LintCapacity } from "../../scheduler/capacity.js";

export interface LintPassOptions {
  readonly worktreeId: WorktreeId;
  readonly root: AbsolutePath;
  readonly commonDir: AbsolutePath;
  readonly source: LintSource;
  /** The policy now: the daemon's, which a revision may reload. */
  readonly policy: () => Policy;
  /** Called at the first pass with `lint.enabled`, so a daemon with it off loads no ESLint (goal 1). */
  readonly provider: () => LintProvider;
  readonly now?: () => EpochMs;
  readonly log: (text: string) => void;
  readonly onError: (error: Error) => void;
  /** Each pass that did something. */
  readonly onPass?: (report: LintPassReport) => void;
}

/** What one pass did, for the daemon's log and the status rows (wave 2). */
export interface LintPassReport {
  /** The revision its keys are at. */
  readonly revision: RevisionNumber;
  /** `edit` follows the revisions; `config` re-keys every file with no transition (D2). */
  readonly mode: "first" | "edit" | "config";
  /** Files it keyed again. */
  readonly keyed: number;
  /** Of those, results it found by key and linted nothing for (D7 step 3, goal 7). */
  readonly hits: number;
  /** Files it linted. */
  readonly linted: number;
  /** Whole-program files that read `stale` until idle (D5). */
  readonly stale: number;
  readonly transitions: number;
}
