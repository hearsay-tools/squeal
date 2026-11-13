import type { SchedulerContext } from "./context.js";
import type { FileState } from "./files.js";
import type { Ledger } from "./ledger.js";

/*
 * Row 011-322: a request as the intake takes it (`RequestIntake.take`). One
 * field per shared rule, in the intake's order; each says what this request
 * does under that rule, or names why it skips it (`Skip`). Leaving out the
 * install-wait answer or the covered files does not compile: a stage returns
 * `Staged`, and a request that writes no store names what it covers.
 */

/** A rule a request does not take, and why: a reviewer searches for `skip:`. */
export interface Skip {
  readonly skip: string;
}

/** What a stage decided: the answer, and the covered files, recorded after the commit. */
export interface Staged<A> {
  readonly answer: A;
  /** The files it queued, or found queued or running, for itself; those not queued nor running count nothing. */
  readonly covered: readonly FileState[];
}

/** Rule 1: the start or closed answer. */
export type StartRule<A> =
  /** Answered at once, before the lock, once closed or before the start; `nothing`: it asks for nothing. */
  | { readonly closed: A; readonly nothing?: boolean }
  /** Row 011-198: taken only once a pass started after it was delivered; else it throws (`NO_PASS`). */
  | (Skip & { readonly afterPass: true })
  | Skip;

/** Rule 2: the answer while an install is awaited, or after a reinstall. */
export type InstallWaitRule<A, P> =
  /** At once, before the lock, with the closed answer. */
  | { readonly atOnce: A }
  /**
   * Under the lock, in its transaction instead of its stage. `passFirst`: an
   * awaited install's pass, which may end the wait, runs before the lock.
   */
  | {
      readonly stage: (context: SchedulerContext, ledger: Ledger) => A;
      readonly passFirst?: true;
    }
  /** Under the lock, from its plan (`always`), writing nothing. */
  | { readonly answer: (context: SchedulerContext, ledger: Ledger, plan: P, reason: string) => A }
  | Skip;

/** What `always` runner work decided: the plan its stage takes, or the answer at once. */
export type Planned<A, P> = { readonly plan: P } | { readonly answer: A };

/** What the runner said when asked again: keyed, tried again while busy, stored with the stage. */
export interface Recovery {
  key(n: number): Promise<void>;
  store(ledger: Ledger): void;
}

/** Rule 3: the runner work the request waits for. */
export type RunnerWorkRule<A, P> =
  /**
   * When runner work is pending or a runner failure outstanding, the stage
   * waits for it, under the lock through every try; the runner is asked again
   * first (`null`: nothing to recover).
   */
  | {
      readonly whenPending: (context: SchedulerContext, ledger: Ledger) => Promise<Recovery | null>;
    }
  /** Always: under the lock, behind the runner work queued before it; the plan may ask the runner. */
  | { readonly always: (context: SchedulerContext, ledger: Ledger) => Promise<Planned<A, P>> }
  | Skip;

/** Taken first, under a lock of its own, outside the store's transaction. */
export interface Outside<A> extends Skip {
  /** `null`: not this kind of request after all; the stage takes it. */
  readonly release: (context: SchedulerContext, ledger: Ledger) => { readonly answer: A } | null;
  /** What starts its work, before the pump. */
  readonly work: () => void;
}

/** Rules 4 and 5: the store write, and the covered files it records after the commit. */
export interface StageRule<A, P> {
  readonly stage: (context: SchedulerContext, ledger: Ledger, plan: P) => Staged<A>;
  readonly outside?: Outside<A>;
}

/** No store write: under the lock once; `covers` names why it records no file. */
export interface ApplyRule<A> extends Skip {
  readonly covers: Skip;
  readonly apply: (context: SchedulerContext, ledger: Ledger) => A;
}

/** Rule 6. */
export type WakeRule =
  /** Every group's lane, before the lock: the reason. */
  | { readonly allLanes: string }
  /** The group's lane, after the record. */
  | { readonly lane: string }
  /** The tiers in flight are checked, after its change. */
  | { readonly cutTiers: true }
  | Skip;

export interface Request<A, P = undefined> {
  /** What it does, for a lock watcher (row 011-302) and a busy wait: "taking ...". */
  readonly operation: string;
  readonly start: StartRule<A>;
  readonly installWait: InstallWaitRule<A, P>;
  readonly runnerWork: RunnerWorkRule<A, P>;
  readonly store: StageRule<A, P> | ApplyRule<A>;
  readonly wake: WakeRule;
}

/** A request answered synchronously, with no lock and no store transaction. */
export interface NowRequest<A> {
  readonly operation: string;
  readonly start: { readonly closed: A };
  readonly installWait: { readonly atOnce: A };
  readonly runnerWork: Skip;
  readonly store: Skip & {
    readonly covers: Skip;
    readonly now: (context: SchedulerContext, ledger: Ledger) => A;
  };
  readonly wake: Skip;
}
