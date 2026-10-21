import type { Hasher } from "../hash/index.js";
import type { HostLoad } from "../retry/index.js";
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
import type { TierCapacity } from "./capacity.js";
import type { WorktreeKeys } from "./keying.js";
import type { BacklogQuiet } from "./quiet.js";
import type { FailureDescriber } from "./records.js";

/** What every part of the scheduler reads. One per worktree. */
export interface SchedulerContext {
  /** Worktree root, realpath. */
  readonly root: AbsolutePath;
  readonly worktreeId: WorktreeId;
  readonly store: Store;
  readonly runner: RunnerAdapter;
  readonly sink: StateSink;
  /** Replaced when a revision reloads it (`reloadPolicy`). */
  policy: Policy;
  /** `SchedulerOptions.reloadPolicy`; `null` keeps the policy. */
  readonly reloadPolicy: (changes: readonly FileChange[]) => Policy | null;
  readonly keys: WorktreeKeys;
  readonly hasher: Hasher;
  /** `<store>/runs`; each run logs to `<runsDir>/<run-id>` (D1). */
  readonly runsDir: AbsolutePath;
  readonly describe: FailureDescriber;
  readonly head: () => Promise<HeadState>;
  readonly now: () => EpochMs;
  /** Records a factual note for status, for errors the scheduler worked around. */
  readonly note: (message: string) => void;
  /** `SchedulerOptions.rerunCap`. */
  readonly rerunCap: number;
  /** `SchedulerOptions.hostLoad`; absent, `hostLoad`. */
  readonly hostLoad?: () => HostLoad;
  /** `SchedulerOptions.runnerPartMs`; absent, `runnerPartBoundMs` of the policy's run timeout. */
  readonly runnerPartMs?: number;
  /** `SchedulerOptions.incarnation`. */
  readonly incarnation?: string;
  /** `SchedulerOptions.predecessor`; absent, not known. */
  readonly predecessor?: string | null;
  /** The per-user pool backlog and checkpoint tiers take permits from (`SchedulerOptions.capacity`). */
  readonly capacity?: TierCapacity;
  /** The lanes that wait for quiet after a backlog tier's cancel (C4 step 5, row 011-82); absent, none waits. */
  readonly quiet?: BacklogQuiet;
}

/** Paths that changed at no revision: for baseline and `run --all` ordering. */
export const NOTHING_CHANGED: ReadonlySet<RelativePath> = new Set();

/**
 * Calls the runner and turns a rejection into a note and `null`. `subject`
 * names the call with its test file or paths (review N2); the note, which
 * `onFailure` also receives, is the reason a failed call gives its files.
 *
 * Spec 001 D5: "A runner call that fails is a state, never a skip". Callers
 * decide what the failure means for which files.
 */
export async function tryRunner<T>(
  context: Pick<SchedulerContext, "note">,
  subject: string,
  call: () => Promise<T>,
  onFailure?: (reason: string) => void,
): Promise<T | null> {
  try {
    return await call();
  } catch (error) {
    const reason = `runner ${subject} failed: ${error instanceof Error ? error.message : String(error)}`;
    context.note(reason);
    onFailure?.(reason);
    return null;
  }
}
