import type { AbsolutePath, RelativePath } from "./common.js";
import type { RevisionTrigger } from "./revision.js";

/**
 * Debounce and reconciliation timings.
 *
 * Spec 001 D2: "Each debounced batch (100 ms quiet, 500 ms maximum) is
 * reconciled" and "A reconciliation pass runs every 30 s when idle and on
 * daemon start".
 */
export const WATCHER_TIMINGS = {
  quietMs: 100,
  maxBatchMs: 500,
  reconcileIntervalMs: 30_000,
} as const;

/**
 * A path the backend reports. A hint only; the kind is advisory.
 *
 * Spec 001 D2: "Watcher events are hints. Each debounced batch [...] is
 * reconciled: every reported path is re-stat'ed and, if `mtime`, `size` or
 * inode changed, re-hashed with the git blob hash."
 */
export interface WatchHint {
  readonly path: AbsolutePath;
  readonly kind: "add" | "change" | "unlink" | "unknown";
}

/**
 * What to watch. The daemon builds this from git and rebuilds it when ignore
 * inputs change.
 *
 * Spec 001 D2: "at watch time, exclude `.git`, nested worktree roots, and the
 * output of `git ls-files --others --ignored --exclude-standard --directory`
 * [...] recompute the watch-time list when any `.gitignore` changes or a
 * `.git` entry appears under the root." And: "Gitignored files that appear in
 * a known closure (generated code) are added to the stat cache and watched
 * individually".
 */
export interface WatchSpec {
  readonly root: AbsolutePath;
  /** Directories and files never watched: `.git`, nested worktrees, ignored output. */
  readonly excluded: readonly AbsolutePath[];
  /** Ignored files watched anyway because a closure references them. */
  readonly extraFiles: readonly AbsolutePath[];
}

/**
 * Callbacks from a backend. Called from the backend's event loop; must not
 * throw.
 */
export interface WatchListener {
  onHints(hints: readonly WatchHint[]): void;
  /**
   * The backend lost events (overflow, dropped-events signal from
   * @parcel/watcher). Spec 001 D12: "Watcher backend error or dropped-events
   * signal: full reconciliation pass; a note in status."
   */
  onDropped(reason: string): void;
  onError(error: Error): void;
}

/** A live watch. `update` replaces the spec without losing events where the backend allows it. */
export interface WatchSubscription {
  update(spec: WatchSpec): Promise<void>;
  close(): Promise<void>;
}

/**
 * One filesystem watcher implementation.
 *
 * Spec 001 D2: "The watcher sits behind one internal interface with two
 * backends: chokidar 5 on Linux, @parcel/watcher on macOS." Node's recursive
 * `fs.watch` is excluded.
 */
export interface WatcherBackend {
  readonly name: "chokidar" | "parcel";
  watch(spec: WatchSpec, listener: WatchListener): Promise<WatchSubscription>;
}

/**
 * `lstat` data of one file, as the stat cache records it. The one stat
 * definition shared by the watcher, the hasher and the stat cache: symlinks
 * are described, not followed, matching what git records in its index, and a
 * symlink hashes as git stores it, the blob of its target path. A path with
 * no regular file or symlink has no `FileStat`.
 *
 * Spec 001 D3: "a stat cache `path -> (mtime, ctime, size, inode, hash)`".
 * Same fields as `FileHashRecord` without `path` and `hash`.
 */
export interface FileStat {
  readonly mtimeMs: number;
  readonly ctimeMs: number;
  readonly size: number;
  readonly inode: number;
}

/** One path that may have changed. `stat` is `null` when the path does not exist. */
export interface CandidatePath {
  readonly path: RelativePath;
  readonly stat: FileStat | null;
}

/**
 * Paths that may have changed, after ignore filtering and before hashing.
 * `ChangeFeed` emits one batch at a time; the daemon passes each to
 * `reconcile` (src/core/revision), which takes `trigger` from the batch and
 * each `stat` as the post-event stat without stat-ing again, compares it with
 * the stat cache, hashes what differs, and creates a revision only when a
 * hash changed.
 *
 * Spec 001 D2: "Watcher events are hints. Each debounced batch [...] is
 * reconciled: every reported path is re-stat'ed and, if `mtime`, `size` or
 * inode changed, re-hashed". Only files and symlinks appear; directories are
 * expanded into the files under them.
 */
export interface CandidateBatch {
  readonly trigger: RevisionTrigger;
  /** Sorted, unique. Empty only for reconciliation batches, which are always emitted. */
  readonly paths: readonly CandidatePath[];
}
