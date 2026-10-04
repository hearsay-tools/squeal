import type { Hasher } from "../hash/index.js";
import type { HeadState } from "../revision/index.js";
import type {
  AbsolutePath,
  EpochMs,
  Policy,
  RelativePath,
  RunnerAdapter,
  StateSink,
  Store,
  WorktreeId,
} from "../types/index.js";
import type { WorktreeKeys } from "./keying.js";
import type { FailureDescriber } from "./records.js";

/** What every part of the scheduler reads. One per worktree. */
export interface SchedulerContext {
  /** Worktree root, realpath. */
  readonly root: AbsolutePath;
  readonly worktreeId: WorktreeId;
  readonly store: Store;
  readonly runner: RunnerAdapter;
  readonly sink: StateSink;
  readonly policy: Policy;
  readonly keys: WorktreeKeys;
  readonly hasher: Hasher;
  /** `<store>/runs`; each run logs to `<runsDir>/<run-id>` (D1). */
  readonly runsDir: AbsolutePath;
  readonly describe: FailureDescriber;
  readonly head: () => Promise<HeadState>;
  readonly now: () => EpochMs;
  /** Records a factual note for status, for errors the scheduler worked around. */
  readonly note: (message: string) => void;
}

/** Paths that changed at no revision: for baseline and `run --all` ordering. */
export const NOTHING_CHANGED: ReadonlySet<RelativePath> = new Set();

/**
 * Calls the runner and turns a rejection into a note and `null`. Spec 001 D5
 * inputs (review): "A broken config makes every adapter call reject until it
 * is fixed [...]: map that to `unknown` for the project with one status note,
 * never to stored results."
 */
export async function tryRunner<T>(
  context: Pick<SchedulerContext, "note">,
  what: string,
  call: () => Promise<T>,
): Promise<T | null> {
  try {
    return await call();
  } catch (error) {
    context.note(
      `runner ${what} failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}
