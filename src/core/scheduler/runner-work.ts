import { testFileId } from "../keys/reverse-index.js";
import { isBusy } from "../store/connection.js";
import type { RelativePath } from "../types/common.js";
import type { TestFileRef } from "../types/keys.js";
import type { Revision } from "../types/revision.js";
import type { RunnerClosure } from "../types/runner.js";
import type { SchedulerContext } from "./context.js";
import { OwedRunnerWork } from "./deferred-keying.js";
import type { Ledger } from "./ledger.js";
import { type ApplyHost, applyRefinement, recordRefined } from "./refine-apply.js";
import { fetchRunnerPart, recheckRunner } from "./refinement.js";
import type { ContentRekey } from "./revision.js";
import { runnerPartBound } from "./runner-work-bound.js";
import { type QueuedRefine, supersede } from "./superseded.js";

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
  /** A runner-only refinement of touched paths (`queueTouched`), until it starts. */
  readonly touched?: Set<RelativePath>;
  /** A recheck (`queueRecheck`), which stands in for no refinement. */
  readonly recheck?: true;
  /** Spec 026 D1: a deferred revision recorded refined with no runner call; stands in for none. */
  readonly recorded?: true;
  /** A revision's runner part (`queueRefine`) until it starts; a newer revision supersedes it. */
  queued?: QueuedRefine;
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
export interface RunnerWorkHost extends ApplyHost {
  started(): { context: SchedulerContext; ledger: Ledger };
  pump(): void;
  /** An error of work no caller awaits: a note for status, and `onError`. */
  backgroundError(subject: string, error: unknown): void;
  /** Spec 026 D1: runner keying is deferred, so runner work is owed, not queued; absent, never. */
  deferred?(): boolean;
}

/** The runner work of one scheduler, applied by its pump beside the tiers in flight (task 001-140). */
export class RunnerWork {
  /** Runner work in arrival order; no tier is selected while any is left. */
  readonly #tasks: RunnerTask[] = [];
  /** A refinement is in its runner phase: shifted off `#tasks`, not applied yet. */
  #refining = false;
  /** Test files whose closure went stale while a refinement fetched it; the next one resolves them again. */
  readonly #carried = new Map<string, TestFileRef>();
  /** Spec 026 D1.2: the runner work deferred keying owes the next wake (`catchUp`). */
  readonly #owed = new OwedRunnerWork();

  constructor(private readonly host: RunnerWorkHost) {}

  get size(): number {
    return this.#tasks.length;
  }

  get refining(): boolean {
    return this.#refining;
  }

  /**
   * Queues the runner part of `revision`, and of the files its batch touched
   * (`queueTouched`). One of an earlier revision queued and not started yet
   * takes it instead (`supersede`, row 011-396): while edits come faster
   * than the runner lists them, only the newest revision is listed, beside
   * the one in flight.
   */
  queueRefine(
    revision: Revision,
    content: ContentRekey,
    touched: readonly RelativePath[] = [],
  ): void {
    const newer: QueuedRefine = { revision, content, touched };
    if (this.#deferred()) {
      this.#owed.addRefine(newer);
      this.#recordDeferred(revision.number);
      return;
    }
    this.#pushRefine(newer);
  }

  #pushRefine(newer: QueuedRefine): void {
    const waiting = this.#tasks.find((task) => task.queued !== undefined);
    if (waiting?.queued !== undefined) {
      waiting.queued = supersede(waiting.queued, newer);
      return;
    }
    const task: RunnerTask = {
      run: () => {
        const { revision: last, content: found, touched: paths } = task.queued ?? newer;
        return this.#refine(last, found, last.number, paths);
      },
      cancel: () => {},
      refine: true,
      queued: newer,
    };
    this.#tasks.push(task);
  }

  /**
   * Queues a runner-only refinement for files a batch touched whose bytes
   * ended as they were (task 001-159): no revision names them, but the
   * runner may hold what it read of them in between. It invalidates them
   * as `touch`, and takes what a recreate the runner reports for it re-keys.
   * One queued and not started yet takes the paths instead: a build that
   * rewrites its output in several batches costs one recreate.
   */
  queueTouched(touched: readonly RelativePath[]): void {
    if (this.#deferred()) this.#owed.addTouched(touched);
    else this.#pushTouched(touched);
  }

  #pushTouched(touched: readonly RelativePath[]): void {
    const queued = this.#tasks.find((task) => task.touched !== undefined)?.touched;
    if (queued !== undefined) {
      for (const path of touched) queued.add(path);
      return;
    }
    const paths = new Set(touched);
    this.#tasks.push({
      run: () => {
        const { context, ledger } = this.host.started();
        return this.#refine(unchanged(context, ledger), NO_CONTENT, null, [...paths].sort());
      },
      cancel: () => {},
      refine: true,
      touched: paths,
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
    if (this.#deferred()) this.#owed.addObserved();
    else this.#pushObserved();
  }

  #pushObserved(): void {
    const standsIn = (task: RunnerTask) =>
      task.refine === true && task.recheck !== true && task.recorded !== true;
    if (this.#tasks.some(standsIn)) return;
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
   * Queues a recheck for a reconciliation pass that applied and touched
   * nothing (task 007-26): the runner looks at what no watched file shows
   * (`RunnerAdapter.recheck`), and only the projects it reports recreated
   * are refined, as a recreate `invalidate` reports is. Any refinement
   * queued and not started yet stands in, since `invalidate` looks too.
   */
  queueRecheck(): void {
    // Spec 026 D1.2: the wake's refinement looks too, as `invalidate` does.
    if (!this.#deferred()) this.queueWake();
  }

  /**
   * Review 0.1.616 B1: the recheck that lists and keys a runner an explicit
   * request opened, queued even while the keying is deferred. A refinement
   * queued and not started stands in, since its `invalidate` reports the
   * runner's projects recreated too (`CompositeGate`).
   */
  queueWake(): void {
    if (this.#tasks.some((task) => task.refine === true && task.recorded !== true)) return;
    this.#tasks.push({
      run: () => {
        const { context, ledger } = this.host.started();
        return this.#refine(unchanged(context, ledger), NO_CONTENT, null, [], true);
      },
      cancel: () => {},
      refine: true,
      recheck: true,
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
    this.#owed.clear();
  }

  /** Spec 026 D1: runner work is owed (`catchUp`), not queued. */
  get owes(): boolean {
    return this.#owed.owes;
  }

  /**
   * Spec 026 D1.4: an explicit request wakes the runner. The runner work
   * owed since the last wake is queued, as one refinement of every
   * revision since (`supersede`), the touched paths and the observed
   * regrow, so the request's work waits for it. False: none was owed.
   */
  catchUp(): boolean {
    const owed = this.#owed.take();
    if (owed === null) return false;
    if (owed.refine !== null) this.#pushRefine(owed.refine);
    if (owed.touched.length > 0) this.#pushTouched(owed.touched);
    if (owed.observed) this.#pushObserved();
    return true;
  }

  /**
   * Spec 026 D1.4: a wake's start lists, walks and keys every file afresh,
   * so the owed work is dropped; its paths, which no runner saw change,
   * are returned for the start to queue as edits.
   */
  forgetOwed(): ReadonlySet<RelativePath> {
    const owed = this.#owed.take();
    if (owed === null) return new Set();
    const changes = owed.refine?.revision.changes.map((change) => change.path) ?? [];
    return new Set([...changes, ...(owed.refine?.touched ?? []), ...owed.touched]);
  }

  #deferred(): boolean {
    return this.host.deferred?.() === true;
  }

  /**
   * Spec 026 D1.3: a deferred revision is re-keyed from stored closures
   * only; it is recorded refined in arrival order, so no wait hangs on the
   * runner part it owes. A reinstall drops it, as any refinement.
   */
  #recordDeferred(revision: Revision["number"]): void {
    this.#tasks.push({
      run: () => this.#markRefined(this.host.started().context, revision),
      cancel: () => {},
      refine: true,
      recorded: true,
    });
  }

  /**
   * Row 015-117: queues one chunk of the once-after-upgrade re-walk. Its
   * runner phase reads the closures without the lock, as a refinement's
   * does, so batches are reconciled meanwhile; `apply` takes the lock with
   * the paths they changed. A closure the runner fails is left out: the
   * re-walk is no state, so it writes no note and blocks no file.
   */
  queueRewalk(
    refs: readonly TestFileRef[],
    apply: (
      closures: readonly RunnerClosure[],
      changedMeanwhile: ReadonlySet<RelativePath>,
    ) => void,
  ): void {
    this.#tasks.push({ run: () => this.#rewalk(refs, apply), cancel: () => {} });
  }

  async #rewalk(
    refs: readonly TestFileRef[],
    apply: (
      closures: readonly RunnerClosure[],
      changedMeanwhile: ReadonlySet<RelativePath>,
    ) => void,
  ): Promise<void> {
    const { context, ledger } = this.host.started();
    try {
      ledger.refineChanges = new Set();
      const bound = runnerPartBound(context);
      const closures: RunnerClosure[] = [];
      for (const ref of refs) {
        if (this.host.closed()) return;
        try {
          closures.push(await bound.call(() => context.runner.closure(ref)));
        } catch {
          // Its next refinement or run walks it, as before this pass.
        }
      }
      await this.host.lock.run(async () => {
        const changed = ledger.refineChanges ?? new Set<RelativePath>();
        ledger.refineChanges = null;
        apply(closures, changed);
      }, "storing the re-read imports");
    } catch (error) {
      this.host.backgroundError("could not re-read imports", error);
    } finally {
      ledger.refineChanges = null;
    }
  }

  /**
   * The runner part of one revision, in two phases (review wave 4.5, S3).
   * The runner phase calls the runner without the lock, so batches are
   * reconciled meanwhile; the apply phase takes the lock, applies what the
   * runner said, and commits it with the revision as refined (D2 as
   * amended). A busy store's refusal is tried again (`applyRefinement`, spec
   * 021 D2). Never rejects: another error is a note, and the revision counts
   * as refined so no wait hangs on it. A runner-only refinement (`refined`
   * `null`) commits no refined revision.
   */
  async #refine(
    revision: Revision,
    content: ContentRekey,
    refined: Revision["number"] | null,
    touched: readonly RelativePath[] = [],
    recheck = false,
  ): Promise<void> {
    const { context, ledger } = this.host.started();
    this.#refining = true;
    try {
      ledger.refineChanges = new Set();
      const rechecked = recheck ? await recheckRunner(context) : undefined;
      // Nothing moved: no other runner call at a quiet pass.
      if (rechecked?.length === 0) return;
      const carried = [...this.#carried.values()];
      this.#carried.clear();
      const part = await fetchRunnerPart(
        context,
        ledger,
        revision,
        content,
        carried,
        touched,
        rechecked,
      );
      await applyRefinement(this.host, context, ledger, part, refined, (stale) => {
        for (const ref of stale) this.#carried.set(testFileId(ref), ref);
      });
    } catch (error) {
      // Spec 021 D2: refused while the scheduler closes, the revision stays unrefined for the next start.
      if (this.host.busy?.() !== undefined && isBusy(error) && this.host.closed()) return;
      // Row 015-52: what a runner part that threw listed is not known; the next one lists again.
      ledger.listingFailed = true;
      if (refined === null) {
        this.host.backgroundError("could not apply observed paths", error);
      } else {
        this.host.backgroundError(`could not apply revision ${refined}`, error);
        await this.#markRefined(context, refined);
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

  /**
   * Runs `task` under the lock once the runner work before it is done;
   * `operation` names it to a lock watcher (row 011-302).
   */
  afterTier<T>(task: () => Promise<T>, operation: string): Promise<T> {
    if (this.host.closed()) return Promise.reject(new Error("squeal scheduler: closed"));
    return new Promise<T>((resolve, reject) => {
      this.#tasks.push({
        run: () => this.host.lock.run(task, operation).then(resolve, reject),
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
   * A refinement that threw on anything but a busy store is not pending any
   * more: nothing retries it, and its note says what failed. Its revision is
   * recorded as refined, so waits do not wait for it forever (D2 as
   * amended); that write is tried again on a busy store (spec 021 D2). A
   * deferred revision is recorded so too (spec 026 D1.3, `#recordDeferred`).
   */
  async #markRefined(context: SchedulerContext, revision: number): Promise<void> {
    try {
      await recordRefined(this.host, context, revision);
    } catch (error) {
      this.host.backgroundError(`could not record revision ${revision} as refined`, error);
    }
  }
}
