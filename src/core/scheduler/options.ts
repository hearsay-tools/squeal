import type { PoolCapacity } from "../capacity/index.js";
import type { Hasher } from "../hash/index.js";
import type { HostLoad } from "../retry/index.js";
import type { HeadState } from "../revision/index.js";
import type { BusyWaits } from "../store/index.js";
import type {
  AbsolutePath,
  EpochMs,
  FeedPasses,
  FileChange,
  Policy,
  RelativePath,
  RunnerAdapter,
  StateSink,
  Store,
  WorktreeId,
} from "../types/index.js";
import type { FailureDescriber } from "./records.js";

export interface SchedulerOptions {
  /** Worktree root. Must be its realpath, like the runner's. */
  readonly root: AbsolutePath;
  readonly worktreeId: WorktreeId;
  readonly store: Store;
  readonly runner: RunnerAdapter;
  /** Known state and transitions (task 001-21). */
  readonly sink: StateSink;
  readonly policy: Policy;
  readonly squealVersion: string;
  /** `StorePaths.runsDir`; each run logs to `<runsDir>/<run-id>` (D1). */
  readonly runsDir: AbsolutePath;
  /** `HEAD` and the dirty flag for new revisions. */
  readonly head: () => Promise<HeadState>;
  /** Summary and fingerprint of a failure. Defaults to `describeFailure` (D6). */
  readonly describeFailure?: FailureDescriber;
  /**
   * The most new failures of one tier that are re-run (task 001-171): with
   * more, none is, and a note says why. Defaults to `RERUN_CAP`.
   */
  readonly rerunCap?: number;
  /**
   * The host's one-minute load and CPU count, read when a `load` retry may
   * run and when a tier starts (001-368). Defaults to `hostLoad`.
   */
  readonly hostLoad?: () => HostLoad;
  /**
   * The longest one runner-part call is awaited before it is abandoned (task
   * 001-228). Defaults to `runnerPartBoundMs` of policy `runner.timeoutMs`.
   */
  readonly runnerPartMs?: number;
  /**
   * The daemon's incarnation (`daemonIncarnation`), which each commit names
   * as the writer of the store's re-key moves (task 001-268). Absent: none,
   * and no wait trusts the moves.
   */
  readonly incarnation?: string;
  /**
   * The incarnation of the daemon registered on the worktree before this
   * one (`predecessorIncarnation`), `null` when none ever was. The first
   * commit takes in what it left unless it wrote the record's moves last
   * (`adoptsAtFirstCommit`). Absent: not known, and the first commit does.
   */
  readonly predecessor?: string | null;
  /**
   * The start resumes a rest (spec 011 C9 as amended 2026-10-21, row
   * 011-91): the daemon before it stopped unused and no heartbeat came
   * after. Whatever `baseline.onStart`, the baseline queues what the start
   * revision and each unrefined revision reached, a file hashed for the
   * first time counting as added by the start revision. Absent: no rest.
   */
  readonly resumesRest?: boolean;
  /**
   * The full extra-file list whenever it grows. Called while a batch is being
   * handled: hand it to `ChangeFeed.setExtraFiles` without awaiting, because
   * the feed delivers the next batch only after this one.
   */
  readonly onExtraFiles?: (paths: readonly RelativePath[]) => void;
  /**
   * Row 015-52: called once after each committed transaction that records a
   * refined revision, the baseline's and a revision's runner part, so the
   * code pass counts the files it held for their listing. Never inside the
   * transaction; a throw goes to `onError` and fails nothing.
   */
  readonly onRefined?: () => void;
  /**
   * Row 011-198: the change feed's passes. `requestFullSuite` notes how many started, awaits a
   * pass outside the lock, and plans only when one that started after the note was delivered;
   * otherwise it rejects and records no checkpoint. A lagging feed delays the checkpoint, and a
   * failed or closed one gives none: neither plans it at a revision older than the worktree.
   * Absent: no pass first.
   */
  readonly passes?: FeedPasses;
  /**
   * Called with the changes of every new revision, inside the transaction
   * that stores it. Returns the policy to apply from this revision on, or
   * `null` to keep the current one; the daemon reloads when the changes
   * include `squeal.config.json` (spec 001 D11, review S3). A new `inputs`
   * re-selects the declared inputs and re-assembles every closure; a new
   * `env.allowlist` moves every environment hash and reads the environments
   * again, the same paths a content or config change takes. `runner.*` keys
   * apply from the next tier; `baseline.onStart` only at the next start.
   */
  readonly reloadPolicy?: (changes: readonly FileChange[]) => Policy | null;
  /**
   * Errors of background work: tiers, the runner part of a revision,
   * persisting notes. Errors storing a revision reject `handleBatch`.
   */
  readonly onError?: (error: Error) => void;
  /**
   * Task 001-422: the busy wait of each write the pump awaits, below the
   * store's own (`BUSY_SLICE_MS` in the daemon), only with `busyWaits`,
   * whose give-up resumes the pump (row 011-132 slice 4). Absent, or
   * without `busyWaits`: the store's.
   */
  readonly busySliceMs?: number;
  /**
   * Task 001-422: where the pump reports a write that gave up on a busy
   * store, and its resume. With it, such an error is no stall and no note:
   * the pump resumes after `busyBackoffMs`.
   */
  readonly busyWaits?: BusyWaits;
  /**
   * The install went under the running scheduler (a reinstall, task
   * 001-113): it stores nothing more. Or the daemon's own runtime went
   * (`runtimeDir`, row 011-106): it starts no tier. Persist `note` and close;
   * the next daemon starts fresh. Without it the scheduler persists the note
   * itself.
   */
  readonly onReinstall?: (note: string) => void;
  /**
   * The daemon's own module directory (row 011-106): before each tier and
   * when a tier ends the scheduler checks it is there. Once it is gone, no
   * tier starts, the files stay queued for the next daemon, a tier that ran
   * meanwhile is queued again once per key, and `onReinstall` gets
   * `runtimeGoneNote`. Absent: never checked.
   */
  readonly runtimeDir?: AbsolutePath;
  /**
   * The daemon's stop began (its phase is `stopping`), which it sets before
   * the scheduler's close: no tier starts, and a tier that crashes then is an
   * interrupted run, queued again once per key (row 011-66). Without it, the
   * scheduler's own close.
   */
  readonly stopping?: () => boolean;
  readonly hasher?: Hasher;
  /** Allow-listed variables for the environment hash. Defaults to `process.env`. */
  readonly env?: NodeJS.ProcessEnv;
  readonly now?: () => EpochMs;
  /** How the slow tier waits (spec 004 D2, D3); defaults suit a daemon. */
  readonly slow?: SlowTierOptions;
  /**
   * The per-user pool of test processes (spec 001 D11 Capacity, task
   * 001-376): backlog and checkpoint tiers take a grant from it, an edit's
   * tier never does. Absent: no pool, and no tier carries a grant.
   */
  readonly capacity?: CapacityOptions;
}

/** Where the pool is and how large; the numbers come from the user's config (task 001-377). */
export interface CapacityOptions extends PoolCapacity {
  /** The pool's directory: the slow slot's, `slowSlotDir()` (spec 004 D2). */
  readonly dir: AbsolutePath;
  /** How often a daemon running a backlog tier refreshes its mark; default `MARK_REFRESH_MS`. */
  readonly refreshMs?: number;
}

/** The slow tier's surroundings, for tests and the daemon. */
export interface SlowTierOptions {
  /** Directory of the per-user slot (`slow.lock`). Default `slowSlotDir()` (spec 004 D2). */
  readonly slotDir?: AbsolutePath;
  /**
   * How often pending slow work that cannot start is looked at again: the
   * slot taken, a consumer in a turn. Also the load guard's recheck (D3).
   * Default and maximum 15000.
   */
  readonly recheckMs?: number;
  /** The load guard's readings (`CapacityWait.load`, `cpus`); default the host's. */
  readonly load?: () => readonly number[];
  readonly cpus?: () => number;
}
