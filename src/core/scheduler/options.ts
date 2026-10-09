import type { Hasher } from "../hash/index.js";
import type { HeadState } from "../revision/index.js";
import type {
  AbsolutePath,
  EpochMs,
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
   * The full extra-file list whenever it grows. Called while a batch is being
   * handled: hand it to `ChangeFeed.setExtraFiles` without awaiting, because
   * the feed delivers the next batch only after this one.
   */
  readonly onExtraFiles?: (paths: readonly RelativePath[]) => void;
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
   * The install went under the running scheduler (a reinstall, task
   * 001-113): it stores nothing more. Persist `note` and close; the next
   * daemon starts fresh. Without it the scheduler persists the note itself.
   */
  readonly onReinstall?: (note: string) => void;
  readonly hasher?: Hasher;
  /** Allow-listed variables for the environment hash. Defaults to `process.env`. */
  readonly env?: NodeJS.ProcessEnv;
  readonly now?: () => EpochMs;
  /** How the slow tier waits (spec 004 D2, D3); defaults suit a daemon. */
  readonly slow?: SlowTierOptions;
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
