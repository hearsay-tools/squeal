import { testFileId } from "../keys/index.js";
import {
  type RelativePath,
  type Revision,
  refinedMetaKey,
  type TestFileRef,
} from "../types/index.js";
import type { SchedulerContext } from "./context.js";
import type { Ledger } from "./ledger.js";
import type { Mutex } from "./mutex.js";
import { applyRunnerPart, fetchRunnerPart } from "./refinement.js";
import type { ContentRekey } from "./revision.js";

/**
 * Work that calls the runner outside a tier: the refinement of a revision, a
 * `run --all` while a runner failure is outstanding. `run` never rejects;
 * `cancel` settles it when the scheduler closes first.
 */
interface RunnerTask {
  run(): Promise<void>;
  cancel(): void;
  /** The runner part of a revision, which a reinstall drops (`dropRefinements`). */
  readonly refine?: true;
}

/** A runner-only refinement re-keys no content. */
const NO_CONTENT: ContentRekey = { rekeyed: [], environment: false };

/**
 * The current revision with no changed path, for a runner-only refinement:
 * the runner phase reads only its changes, and it is never stored.
 */
function unchanged(context: SchedulerContext, ledger: Ledger): Revision {
  const { number, head, dirty } = ledger.revision;
  const { worktreeId, now } = context;
  return { worktreeId, number, createdAt: now(), head, dirty, trigger: "interval", changes: [] };
}

/** What the runner work needs from its scheduler. */
export interface RunnerWorkHost {
  readonly lock: Mutex;
  started(): { context: SchedulerContext; ledger: Ledger };
  closed(): boolean;
  pump(): void;
  /** An error of work no caller awaits: a note for status, and `onError`. */
  backgroundError(subject: string, error: unknown): void;
}

/** The runner work of one scheduler, applied by its pump beside the tiers in flight (task 001-140). */
export class RunnerWork {
  /** Runner work in arrival order; no tier is selected while any is left. */
  readonly #tasks: RunnerTask[] = [];
  /** A refinement is in its runner phase: shifted off `#tasks`, not applied yet. */
  #refining = false;
  /** Test files whose closure went stale while a refinement fetched it; the next one resolves them again. */
  readonly #carried = new Map<string, TestFileRef>();

  constructor(private readonly host: RunnerWorkHost) {}

  get size(): number {
    return this.#tasks.length;
  }

  get refining(): boolean {
    return this.#refining;
  }

  /** Queues the runner part of `revision`. */
  queueRefine(revision: Revision, content: ContentRekey): void {
    this.#tasks.push({
      run: () => this.#refine(revision, content, revision.number),
      cancel: () => {},
      refine: true,
    });
  }

  /**
   * Queues a runner-only refinement (task 003-26): another worktree grew the
   * observed paths, which may move keys this worktree holds results under.
   * It asks the runner what any refinement asks with no changed path, so the
   * adapters report the grown files and projects and their keys are fetched
   * again; it stores no revision. A refinement queued and not started yet
   * asks the same, so it stands in for this one.
   */
  queueObserved(): void {
    if (this.#tasks.some((task) => task.refine === true)) return;
    this.#tasks.push({
      run: () => {
        const { context, ledger } = this.host.started();
        return this.#refine(unchanged(context, ledger), NO_CONTENT, null);
      },
      cancel: () => {},
      refine: true,
    });
  }

  /**
   * Drops the queued runner parts: the install went under the scheduler, which
   * stores nothing more, and its revisions stay unrefined, so the next
   * daemon's baseline queues their paths as edits (task 001-113). A `run
   * --all` queued behind the tier stays.
   */
  dropRefinements(): void {
    const kept = this.#tasks.filter((task) => task.refine !== true);
    this.#tasks.splice(0, this.#tasks.length, ...kept);
    this.#carried.clear();
  }

  /**
   * The runner part of one revision, in two phases (review wave 4.5, S3).
   * The runner phase calls the runner without the lock, so batches are
   * reconciled meanwhile; the apply phase takes the lock, applies what the
   * runner said, and commits it with the revision as refined (D2 as
   * amended). Never rejects: an error is a note, and the revision counts as
   * refined so no wait hangs on it. A runner-only refinement (`refined`
   * `null`) commits no refined revision.
   */
  async #refine(
    revision: Revision,
    content: ContentRekey,
    refined: Revision["number"] | null,
  ): Promise<void> {
    const { context, ledger } = this.host.started();
    this.#refining = true;
    try {
      ledger.refineChanges = new Set();
      const carried = [...this.#carried.values()];
      this.#carried.clear();
      const part = await fetchRunnerPart(context, ledger, revision, content, carried);
      await this.host.lock.run(async () => {
        const changedMeanwhile = ledger.refineChanges ?? new Set<RelativePath>();
        ledger.refineChanges = null;
        const stale = await applyRunnerPart(context, ledger, part, changedMeanwhile);
        for (const ref of stale) this.#carried.set(testFileId(ref), ref);
        ledger.commit(refined === null ? {} : { refined });
      });
    } catch (error) {
      if (refined === null) {
        this.host.backgroundError("could not apply observed paths", error);
      } else {
        this.host.backgroundError(`could not apply revision ${refined}`, error);
        this.#refinedAfterError(context, refined);
      }
    } finally {
      ledger.refineChanges = null;
      this.#refining = false;
    }
  }

  /** Applies the queued runner work, oldest first. */
  async drain(): Promise<void> {
    while (!this.host.closed()) {
      const task = this.#tasks.shift();
      if (!task) return;
      await task.run();
    }
  }

  /** Runs `task` under the lock once the runner work before it is done. */
  afterTier<T>(task: () => Promise<T>): Promise<T> {
    if (this.host.closed()) return Promise.reject(new Error("squeal scheduler: closed"));
    return new Promise<T>((resolve, reject) => {
      this.#tasks.push({
        run: () => this.host.lock.run(task).then(resolve, reject),
        cancel: () => reject(new Error("squeal scheduler: closed")),
      });
      this.host.pump();
    });
  }

  /** Settles every queued task: the scheduler closed first. */
  cancel(): void {
    for (const task of this.#tasks.splice(0)) task.cancel();
  }

  /**
   * A refinement that threw is not pending any more: nothing retries it, and
   * its note says what failed. Its revision is recorded as refined, so waits
   * do not wait for it forever (D2 as amended).
   */
  #refinedAfterError(context: SchedulerContext, revision: number): void {
    const { store, worktreeId } = context;
    try {
      store.transaction(() => {
        const key = refinedMetaKey(worktreeId);
        const previous = Number(store.meta.get(key) ?? Number.NaN);
        if (!(previous >= revision)) store.meta.set(key, String(revision));
      });
    } catch (error) {
      this.host.backgroundError(`could not record revision ${revision} as refined`, error);
    }
  }
}
