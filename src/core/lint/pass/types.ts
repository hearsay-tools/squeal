import type { ObjectFormat } from "../../hash/blob.js";
import type {
  AbsolutePath,
  EpochMs,
  RelativePath,
  RevisionNumber,
  WorktreeId,
} from "../../types/common.js";
import type { FileHash } from "../../types/keys.js";
import type { LintTool } from "../../types/lint.js";
import type { Policy } from "../../types/policy.js";
import type { SharedCapacity } from "../../types/scheduler.js";
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

/**
 * The pool's side the pass uses (011 C10, agreed 2026-10-26): the
 * scheduler's own `TierCapacity`, shared, never closed by the pass.
 */
export type LintCapacity = SharedCapacity;

export interface LintPassOptions {
  readonly worktreeId: WorktreeId;
  /**
   * The tool this pass runs (D11): one pass per tool, each with its own
   * provider, checks and records. Default `eslint`.
   */
  readonly tool?: LintTool;
  readonly root: AbsolutePath;
  readonly commonDir: AbsolutePath;
  readonly format: ObjectFormat;
  readonly source: LintSource;
  /** The policy now: the daemon's, which a revision may reload. */
  readonly policy: () => Policy;
  /** Called at the first pass with `lint.enabled`, so a daemon with it off loads no ESLint (goal 1). */
  readonly provider: () => LintProvider;
  /**
   * 011 C11's install fingerprint, read when the provider opens or a thread
   * refresh runs: a key's package part (D5, as agreed 2026-10-26, the whole
   * install until per-package identities). Default the root's
   * `installedDependenciesFingerprint`.
   */
  readonly installed?: () => Promise<string>;
  /** The scheduler's pool, shared; `null` or absent, lint runs ungranted. */
  readonly capacity?: () => LintCapacity | null;
  /**
   * Milliseconds until stale whole-program files may lint, 0 now: 004's
   * slow trigger (D5, `lintIdleIn`). Absent, at once.
   */
  readonly idleIn?: () => number;
  /**
   * Row 019-45: milliseconds until the agent pauses (no consumer in a turn,
   * `lintPauseIn`), 0 now. A lint group at `pause` or `stop` lints what
   * waits then (spec 019 D1). Absent, at once.
   */
  readonly pauseIn?: () => number;
  /** Node's major version, a key part (D5); default this process's. */
  readonly nodeMajor?: number;
  readonly now?: () => EpochMs;
  readonly log: (text: string) => void;
  readonly onError: (error: Error) => void;
  /** Each pass that did something. */
  readonly onPass?: (report: LintPassReport) => void;
  /**
   * Row 019-35 (lessons P9): after each record the pass stores, a keying's
   * or a part's, so a commit report waiting for lint takes its update then.
   * Not awaited: the pass never waits for the scheduler.
   */
  readonly onRecorded?: () => void;
  /**
   * Row 011-302: told `true` before a pass keys the tool's checks and
   * `false` once the keying ended, so the daemon's socket can name a
   * keying that blocks the main thread.
   */
  readonly onKeying?: (keying: boolean) => void;
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
