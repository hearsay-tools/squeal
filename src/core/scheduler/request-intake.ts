import { randomUUID } from "node:crypto";
import { type BusyWaits, retryWhileBusy } from "../store/busy.js";
import { isBusy } from "../store/connection.js";
import type { FeedPasses } from "../types/watcher.js";
import type { SchedulerContext } from "./context.js";
import { recordCovered } from "./covered-files.js";
import type { FileState } from "./files.js";
import type { Ledger } from "./ledger.js";
import type { Mutex } from "./mutex.js";
import type {
  NowRequest,
  Recovery,
  Request,
  RequestId,
  Staged,
  StageRule,
  WakeRule,
} from "./request-intake-types.js";

/*
 * Row 011-322 (spec 011 `research/request-intake.md`, decision 3; GLOSSARY
 * "Request intake"): the one place a scheduler takes a request. A request
 * states what it queues and answers, its install-wait answer and its covered
 * files (`request-intake-types.ts`); `take` applies every other rule in one
 * fixed order:
 *
 *   1. the start or closed answer;
 *   2. the install-wait answer;
 *   3. the runner work it waits for;
 *   4. the store write, in one transaction tried again while the store is busy,
 *      with the record of its covered files under the request's id (row 011-325);
 *   5. the progress record of its covered files, after the commit;
 *   6. waking the lanes;
 *   7. starting work (the pump), never after a request that threw.
 *
 * A request leaves a rule out only by a named `skip`. The pump is opaque here.
 */

/** Row 011-198: `run --all` gives no verdict rather than one at a revision older than the tree. */
export const NO_PASS =
  "the change feed delivered no reconciliation pass that started after the request " +
  "(its pass failed, or the daemon closed first), so no checkpoint was planned";

/** What the intake reads and calls of its scheduler. */
export interface IntakeHost {
  readonly lock: Mutex;
  /** Throws before the scheduler started. */
  started(): { context: SchedulerContext; ledger: Ledger };
  /** Started and not closed: otherwise rule 1's closed answer. */
  open(): boolean;
  /** The close began, or the daemon's stop: a busy store's refusal then ends the request. */
  stopping(): boolean;
  /** Why no runner call is made now (an install awaited, a reinstall); `null` when one may be. */
  waiting(): string | null;
  /** An install is awaited: the pass that may end the wait runs first (`passFirst`). */
  awaitingInstall(): boolean;
  /** That pass, which the change feed's passes are too: an interval reconciliation. */
  installPass(): Promise<void>;
  /** Row 011-198: the change feed's passes; absent, no pass first. */
  passes(): FeedPasses | undefined;
  /** Spec 021 D2: each try's writes wait a slice of `sliceMs`; absent, the store's own wait. */
  busy(): { readonly waits: BusyWaits; readonly sliceMs: number | undefined } | undefined;
  /** Runner work queued, or a refinement in flight (`whenPending`). */
  runnerPending(): boolean;
  /** `task` under the lock, after the runner work queued before it (`RunnerWork.afterTier`). */
  afterRunnerWork<T>(task: () => Promise<T>, operation: string): Promise<T>;
  /** Row 018-12: a request's covered files; their ends are activity. */
  record(files: readonly FileState[]): void;
  wakeAll(): void;
  /** `group`'s lane; a group with no lane of its own (`tests`) has none to wake. */
  wakeLane(group: string): void;
  cutTiers(): void;
  pump(): void;
}

/** A stage that met runner work it waits for (`whenPending`). */
const DEFERRED = Symbol("deferred");

export class RequestIntake {
  readonly #host: IntakeHost;
  /** Spec 021 D2: each retried request waits under a key of its own. */
  #retries = 0;

  constructor(host: IntakeHost) {
    this.#host = host;
  }

  /** The request's answer, every rule applied in the fixed order; synchronous for a `NowRequest`. */
  take<A>(request: NowRequest<A>): A;
  take<A, P>(request: Request<A, P>): Promise<A>;
  take<A, P>(request: NowRequest<A> | Request<A, P>): A | Promise<A> {
    if ("now" in request.store) return this.#now(request as NowRequest<A>);
    return this.#take(request as Request<A, P>);
  }

  #now<A>(request: NowRequest<A>): A {
    const host = this.#host;
    if (!host.open()) return request.start.closed;
    if (host.waiting() !== null) return request.installWait.atOnce;
    const { context, ledger } = host.started();
    const answer = request.store.now(context, ledger);
    host.pump();
    return answer;
  }

  async #take<A, P>(request: Request<A, P>): Promise<A> {
    const host = this.#host;
    const { start, installWait, wake } = request;
    if ("closed" in start && (!host.open() || start.nothing === true)) return start.closed;
    if ("atOnce" in installWait && host.waiting() !== null) return installWait.atOnce;
    if ("afterPass" in start) await this.#afterPass();
    // Review wave 11, B1: an install the next reconciliation pass would find ends the wait first.
    if ("passFirst" in installWait && host.awaitingInstall()) {
      await this.#request(request.operation, () => host.installPass());
    }
    if ("allLanes" in wake) host.wakeAll();
    const answer = await this.#locked(request);
    host.pump();
    return answer;
  }

  /** Row 011-198: once a pass that started after the request was delivered. */
  async #afterPass(): Promise<void> {
    const passes = this.#host.passes();
    if (passes === undefined) return;
    const asked = passes.started();
    await passes.pass();
    if ((passes.deliveredPass()?.number ?? 0) <= asked) throw new Error(NO_PASS);
  }

  /** Rules 2 to 6 under the lock: once, behind the runner work, or again on each busy try. */
  #locked<A, P>(request: Request<A, P>): Promise<A> {
    const { operation, runnerWork, store } = request;
    const { lock } = this.#host;
    // Row 011-325: one id per request, the same on every busy try.
    const id = randomUUID();
    if ("apply" in store) {
      return lock.run(() => {
        const { context, ledger } = this.#host.started();
        const answer = store.apply(context, ledger);
        this.#wake(request.wake, []);
        return answer;
      }, operation);
    }
    if ("always" in runnerWork) {
      return this.#host.afterRunnerWork(async () => {
        const { context, ledger } = this.#host.started();
        const reason = this.#host.waiting();
        const planned = await runnerWork.always(context, ledger);
        if ("answer" in planned) return planned.answer;
        const { installWait } = request;
        // Under the lock already: a refused write is tried again without giving the lock up.
        if (reason !== null && "answer" in installWait) {
          const { plan } = planned;
          return this.#request(operation, async () =>
            this.#transact((context, ledger) => {
              const waited = installWait.answer(context, ledger, plan, reason, id);
              if (store.record === undefined)
                recordCovered(context, ledger, id, waited.covered, reason);
              return waited.answer;
            }),
          );
        }
        return this.#request(operation, async () =>
          this.#staged(this.#stage(request, store, planned.plan, id, reason, null, false)),
        );
      }, operation);
    }
    return this.#perTry(request, store, id);
  }

  /**
   * A request with no runner work, or whose runner work is only pending:
   * the lock taken again on each busy try (today's quirk 1). A stage that
   * met pending runner work waits for it, under the lock through every try.
   */
  async #perTry<A, P>(request: Request<A, P>, store: StageRule<A, P>, id: RequestId): Promise<A> {
    const { operation, runnerWork } = request;
    const host = this.#host;
    // No plan without `always` runner work: `P` is `undefined` here.
    const plan = undefined as P;
    if (store.outside !== undefined) {
      const { release, work } = store.outside;
      const released = await host.lock.run(() => {
        const { context, ledger } = host.started();
        return host.waiting() === null ? release(context, ledger) : null;
      }, operation);
      if (released !== null) {
        work();
        return released.answer;
      }
    }
    const pending = "whenPending" in runnerWork ? runnerWork.whenPending : null;
    const first = await this.#request(operation, () =>
      host.lock.run(
        () => this.#stage(request, store, plan, id, host.waiting(), null, pending !== null),
        operation,
      ),
    );
    if (first !== DEFERRED || pending === null) return this.#staged(first);
    return host.afterRunnerWork(async () => {
      const { context, ledger } = host.started();
      const reason = host.waiting();
      const recovered = reason === null ? await pending(context, ledger) : null;
      // Re-review of 0.1.434, B2: what the runner said is keyed, then stored with the stage.
      if (recovered !== null) await this.#request(operation, (n) => recovered.key(n));
      // Under the lock already: a refused stage is tried again without giving the lock up.
      return this.#request(operation, async () =>
        this.#staged(this.#stage(request, store, plan, id, reason, recovered, false)),
      );
    }, `${operation} after the runner work`);
  }

  /**
   * One try, under the lock: the install-wait answer or the stage, in one
   * transaction with the record of its covered files under `id` (row
   * 011-325); after its commit, the stage's covered files are its progress
   * record and its lane or the tiers in flight are woken. An install-wait
   * answer records its covered files not queued, with the reason, and has
   * no progress record and wakes nothing.
   */
  #stage<A, P>(
    request: Request<A, P>,
    store: StageRule<A, P>,
    plan: P,
    id: RequestId,
    reason: string | null,
    recovered: Recovery | null,
    deferWhenPending: boolean,
  ): A | typeof DEFERRED {
    const { installWait } = request;
    const done = this.#transact((context, ledger): Staged<A> | { waited: A } | typeof DEFERRED => {
      if (reason !== null && "stage" in installWait) {
        const waited = installWait.stage(context, ledger, id, reason);
        if (store.record === undefined) recordCovered(context, ledger, id, waited.covered, reason);
        return { waited: waited.answer };
      }
      if (deferWhenPending && (ledger.broken || this.#host.runnerPending())) return DEFERRED;
      recovered?.store(ledger);
      const staged = store.stage(context, ledger, plan, id);
      if (store.record === undefined) recordCovered(context, ledger, id, staged.covered, null);
      return staged;
    });
    if (done === DEFERRED) return DEFERRED;
    if ("waited" in done) return done.waited;
    this.#host.record(done.covered);
    this.#wake(request.wake, done.covered);
    return done.answer;
  }

  #staged<A>(answer: A | typeof DEFERRED): A {
    if (answer === DEFERRED) throw new Error("squeal scheduler: a stage deferred twice");
    return answer;
  }

  /** Rule 6 after the record of `covered`; `allLanes` woke before the lock. */
  #wake(wake: WakeRule, covered: readonly FileState[]): void {
    if ("lane" in wake) this.#host.wakeLane(wake.lane);
    else if ("coveredLanes" in wake) {
      const { queue } = this.#host.started().ledger;
      for (const group of new Set(covered.map((file) => queue.checkGroup(file.ref)))) {
        this.#host.wakeLane(group);
      }
    } else if ("cutTiers" in wake) this.#host.cutTiers();
  }

  /**
   * Spec 021 D2 (review 0.1.434, B2): `stage`, the synchronous part of a
   * socket request that changes the ledger and writes it, in one store
   * transaction taken before it changes anything. A busy store refuses that
   * transaction at its start, so the stage can be tried again whole
   * (`#request`) and never runs twice. Another error rolls the store back,
   * and the ledger is put back as the store holds it (`Ledger.hold`).
   */
  #transact<T>(stage: (context: SchedulerContext, ledger: Ledger) => T): T {
    const { context, ledger } = this.#host.started();
    const restore = ledger.hold([...ledger.files.values()].map((file) => file.ref));
    try {
      return context.store.transaction(() => stage(context, ledger));
    } catch (error) {
      restore();
      throw error;
    }
  }

  /**
   * `once`, a socket request's write (`#transact`, its pass, or a runner
   * retry's keys), tried again while a busy store refuses it, a slice per
   * try (spec 021 D2), with `busyWaits`; once without. `n` counts the tries.
   * A refusal once the scheduler closes or its daemon stops answers the
   * request with an error that says the store was busy, so no request waits
   * past the daemon.
   */
  async #request<T>(operation: string, once: (n: number) => Promise<T>): Promise<T> {
    const busy = this.#host.busy();
    if (busy === undefined) return once(0);
    try {
      return await retryWhileBusy(once, {
        sliceMs: busy.sliceMs,
        waits: busy.waits,
        key: `scheduler:request:${++this.#retries}`,
        what: operation.replace(/^taking /, ""),
        stopped: () => this.#host.stopping(),
      });
    } catch (error) {
      if (!isBusy(error)) throw error;
      throw new Error(`${operation}: the store was still busy when the daemon stopped`, {
        cause: error,
      });
    }
  }
}
