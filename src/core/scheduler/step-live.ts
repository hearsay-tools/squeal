import type { EpochMs } from "../types/common.js";
import type { Revision } from "../types/revision.js";
import { BESIDE_LANE_PREFIX, type CancelCause } from "../types/runner.js";
import type { StepSeen } from "../types/scheduler.js";
import { type Admission, checkTurn } from "./admission.js";
import { besideDone, besideFiles } from "./beside.js";
import type { SchedulerContext } from "./context.js";
import type { GroupTiers } from "./group-tiers.js";
import { runtimeGoneNote } from "./install.js";
import { type InstallStamps, refreshInstall } from "./install-stamp.js";
import type { Ledger } from "./ledger.js";
import type { Mutex } from "./mutex.js";
import type { RunnerWork } from "./runner-work.js";
import type { SlowRelease } from "./slow-release.js";
import type { SlowRun } from "./slow-tier.js";
import {
  type AfterDecision,
  type ProbeRead,
  type Reads,
  type Step,
  type StepPorts,
  step,
  type TurnDecision,
} from "./step.js";
import { inTurn, type SchedulerEvent } from "./step-events.js";
import { liveAsks, liveView } from "./tier-live.js";
import { type Idle, idleOf, planTiers, type TierPlan } from "./tier-plan.js";
import { startNext } from "./tier-start.js";
import { laneOf, type Tier } from "./tiers.js";
import type { TierYields } from "./yields.js";

/*
 * Row 011-365 (card 7, `research/scheduler-step.md`, decision 1: one place
 * to read what happens next; `GLOSSARY.md`, "Scheduler step"): the step's
 * live adapter. `step.ts` decides; this module gives it the scheduler's
 * memory and store as its ports and carries out each decision, in the
 * step's lock turn (`#carry`) or after it (`#carryAfter`), as
 * `DECISION_PLACE` places it. The scheduler keeps the lifecycle: the pump,
 * the flights, the passes and the waits.
 */

/** What the step's live adapter reads and calls in its scheduler. */
export interface StepHost {
  readonly lock: Mutex;
  readonly install: InstallStamps;
  readonly yields: TierYields;
  readonly groups: GroupTiers;
  readonly slowRelease: SlowRelease;
  readonly runnerWork: RunnerWork;
  /** The tiers in flight, by run id. */
  readonly inFlight: ReadonlyMap<string, LiveFlight>;
  /** The daemon's runtime folder (row 011-106), named by the note of its loss. */
  readonly runtimeDir: string | undefined;
  now(): EpochMs;
  started(): { context: SchedulerContext; ledger: Ledger };
  admit(): Admission;
  stalled(): boolean;
  asked(): boolean;
  /** A write gave up on a busy store and none of the pump's landed since. */
  busyWaiting(): boolean;
  /** The queued runner work is being applied. */
  draining(): boolean;
  /** The pool refused a tier since the last look. */
  refused(): boolean;
  /** Spec 011 C4 step 3 as amended (task 011-23): stored results first. */
  adopt(context: SchedulerContext, ledger: Ledger): void;
  /** The lanes no tier may start in now. */
  busyLanes(): Set<string>;
  /** The tiers in flight whose runs have not ended. */
  running(): Tier[];
  /** The runner's `releaseLane` of `lane`, its error noted. */
  releaseLane(lane: string): Promise<void>;
  /** Flies `tier` (`start-tier`). */
  fly(tier: Tier, stamp: string, slow: SlowRun | null, admitted: { readonly turn: number }): void;
  /** The install went under the scheduler (task 001-113). */
  reinstall(ledger: Ledger): void;
  /** Tells the pump's end note once: the reinstall's, or `note`. */
  tellReinstall(note?: string): void;
  /** Applies the queued runner work beside the tiers in flight. */
  drain(): void;
  /** The start facts on disk (row 011-340). */
  probe(): Promise<ProbeRead>;
  /** Reconciles the paths a hold released (row 011-72). */
  reconcileReleased(): Promise<void>;
  /** Queues the import re-walk's next chunk; whether it queued one. */
  queueRewalk(): Promise<boolean>;
}

/** A tier in flight as the adapter reads it. */
export interface LiveFlight {
  readonly tier: Tier;
  /** Ends once the tier recorded, or was put back; never rejects. */
  readonly done: Promise<void>;
  /** Aborted when a command hold begins (row 011-74); `null` for a tier that runs to its end. */
  readonly held: AbortController | null;
}

/** What the pump's step does in its lock turn, for a lock watcher (row 011-302). */
export const STEP_OPERATION = "selecting the next tier";

/** The step's live adapter and carry-out (row 011-365). */
export class StepLive {
  readonly #listeners = new Set<(seen: StepSeen) => void>();
  /** The install was found missing at the last read: a start fact (`StartFacts.installMissing`). */
  #installMissing = false;
  /**
   * A change of the install taken and not refreshed yet: owed until the
   * step's refresh is carried out, so a step that ends first loses none
   * (review 0.1.515 B1).
   */
  #refreshOwed = false;

  constructor(private readonly host: StepHost) {}

  /** The install was found missing at the last read. */
  get installMissing(): boolean {
    return this.#installMissing;
  }

  /** Tells `listener` each step until the returned function is called. */
  onStep(listener: (seen: StepSeen) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /**
   * One step now, after `events`, with `reads` (`null`: inside another lock
   * turn); its turn's decisions were carried out as made. The slow release's
   * wake follows a lane's answer; the listeners hear the step.
   */
  step(events: readonly SchedulerEvent[], reads: Reads | null): Step {
    const turn = { at: this.host.now(), events, reads, ports: this.#ports };
    const decided = step(turn);
    // Row 011-211: a lane its answer left idle (a load guard's wait that ended) counts toward its close.
    if (decided.laneAnswered) this.host.slowRelease.arm();
    this.#told(reads, decided);
    return decided;
  }

  /** Carries out the decisions `decided` placed after its turn, in order; the reads they answer. */
  async after(decided: Step): Promise<Reads> {
    let reads: Reads = {};
    for (const decision of decided.decisions)
      if (!inTurn(decision)) reads = { ...reads, ...(await this.#carryAfter(decision)) };
    return reads;
  }

  /** Tells each listener the step `decided` with `reads`. */
  #told(reads: Reads | null, decided: Step): void {
    if (this.#listeners.size === 0) return;
    const { wake } = decided;
    const seen: StepSeen = {
      inTurn: reads === null,
      reads: Object.keys(reads ?? {}),
      decisions: decided.decisions.map((decision) => decision.kind),
      runnerWork: this.host.runnerWork.size,
      wakes: wake.kind === "turn" ? [] : [wake.kind],
    };
    for (const listener of this.#listeners) listener(seen);
  }

  /** The step's ports: the scheduler's memory and store (row 011-356). */
  readonly #ports: StepPorts = {
    admit: () => this.host.admit(),
    stalled: () => this.host.stalled(),
    asked: () => this.host.asked(),
    // A resume after a busy store runs once with nothing queued too: its writes end the wait.
    busyWaiting: () => this.host.busyWaiting(),
    runnerWork: () => ({ queued: this.host.runnerWork.size, draining: this.host.draining() }),
    yields: {
      tier: (runId) => this.host.inFlight.get(runId)?.tier,
      standsNamed: (tier) => this.host.yields.standsNamed(tier),
    },
    startNext: (admitted, at, fly) => {
      const { context, ledger } = this.host.started();
      this.host.adopt(context, ledger);
      // Row 011-346: the tier plan, then its act step; `fly` throws on an answer of another turn.
      const next = startNext(context, ledger, this.#plan(context, ledger, at), {
        check: (lane) => checkTurn(admitted, this.host.lock.turn, lane),
        fly,
      });
      return { idle: "tier" in next ? null : next.idle };
    },
    askLane: (group, at, fly) => {
      const { context, ledger } = this.host.started();
      const lane = this.host.groups.get(group);
      const doing = (operation: string) => this.host.lock.relabel(operation);
      const view = { at, context, ledger, admit: () => this.host.admit(), doing };
      const decided = lane === undefined ? "none" : lane.decide(view, fly);
      // Row 011-357: the step's turn goes on after the lane under its own text.
      this.host.lock.relabel(STEP_OPERATION);
      return decided;
    },
    idleNow: (at) => this.#idleNow(at),
    idleLanes: () => this.host.slowRelease.idleLanes(),
    slowQueued: (lane) => {
      const { context, ledger } = this.host.started();
      return ledger.orderedSlow().some((ref) => laneOf(context, ref) === lane);
    },
    besideDone: (lane) => {
      const { context, ledger } = this.host.started();
      return besideDone(context, ledger, this.host.running(), lane);
    },
    claimsWaiting: () => this.host.started().ledger.claims.waiting,
    refused: () => this.host.refused(),
    inFlight: () => this.host.inFlight.size,
    carry: (decision, at) => this.#carry(decision, at),
  };

  /**
   * The tier plan of the fast lanes (row 011-346): the free lanes first;
   * when they start nothing, a tier beside a running batch's tier
   * (`besideFiles`, spec 011 C4 step 5 as amended 2026-10-29, row 011-269),
   * an edit's tier of its lane in the lane's second instance; after a
   * backlog slot, the next selection again, so a lane of slots fills every
   * free slot in this hold and its slots end, and record, together (task
   * 011-21 slice 2).
   */
  #plan(context: SchedulerContext, ledger: Ledger, now: EpochMs): TierPlan {
    const view = liveView(context, ledger, {
      busy: () => this.host.busyLanes(),
      cut: this.host.yields,
      beside: () => besideFiles(context, ledger, this.host.running()),
      slots: true,
      now,
    });
    return planTiers(view, liveAsks(context, ledger));
  }

  /** Why no fast tier starts at the step's reading `now`: what the plan answers when it ends idle. */
  #idleNow(now: EpochMs): Idle {
    const { context, ledger } = this.host.started();
    const busy = () => this.host.busyLanes();
    const view = liveView(context, ledger, { busy, cut: this.host.yields, now });
    return idleOf(view, liveAsks(context, ledger));
  }

  /**
   * The yield check in this lock turn, after `trigger`, taking stored
   * results first when `adopt` (row 011-123); a hold reaches nothing (row
   * 011-72): the check reads it in its own lock turn. `at` is the step's
   * one reading (row 011-366).
   */
  #checkYields(trigger: Revision | null, adopt: boolean, at: EpochMs): void {
    const { context, ledger } = this.host.started();
    if (adopt) this.host.adopt(context, ledger);
    const held = this.host.admit().halts.has("held");
    const tiers = [...this.host.inFlight.values()].map(({ tier }) => tier);
    this.host.yields.check(context, ledger, tiers, trigger, held, at);
  }

  /** Carries out a decision placed in the step's lock turn, as the step makes it. */
  #carry(decision: TurnDecision, at: EpochMs): void {
    switch (decision.kind) {
      case "start-tier":
        this.host.fly(decision.tier, decision.stamp, decision.slow ?? null, decision);
        return;
      case "check-yields":
        this.#checkYields(decision.trigger, decision.adopt, at);
        return;
      case "reinstall":
        this.host.reinstall(this.host.started().ledger);
        return;
      case "tell":
        if (decision.note === "reinstalled") this.host.tellReinstall();
        else this.host.tellReinstall(runtimeGoneNote(this.host.runtimeDir ?? ""));
        return;
      case "drain":
        this.host.drain();
        return;
      default:
        unplaced(decision);
    }
  }

  /** Carries out a decision placed after the step's turn; a read's answer goes to the next step. */
  async #carryAfter(decision: AfterDecision): Promise<Reads> {
    switch (decision.kind) {
      case "read-install": {
        const install = await this.host.install.check();
        this.#installMissing = install.missing !== null;
        // Task 001-109 (review wave-11b S2, agreed with the coordinator). A change taken is owed
        // until its refresh is carried out, so a step that ends first loses none (review 0.1.515 B1).
        const { missing } = install;
        if (missing === null && this.host.install.takeChange(install)) this.#refreshOwed = true;
        const changed = missing === null && this.#refreshOwed;
        return { install: { stamp: install.stamp, missing: missing !== null, changed } };
      }
      case "read-probe":
        return { probe: await this.host.probe() };
      case "refresh-install":
        await this.host.lock.run(() => {
          const { context, ledger } = this.host.started();
          return refreshInstall(context, ledger);
        }, "refreshing the install");
        this.#refreshOwed = false;
        return {};
      case "reconcile":
        await this.host.reconcileReleased();
        return {};
      case "close-lanes":
        await this.host.slowRelease.closeIdle(decision.lanes);
        return {};
      case "queue-rewalk":
        return { rewalk: await this.host.queueRewalk() };
      case "cancel-held":
        await this.#cancelHeld();
        return {};
      case "close-beside":
        await this.host.releaseLane(`${BESIDE_LANE_PREFIX}${decision.lane}`);
        return {};
      default:
        return unplaced(decision);
    }
  }

  /**
   * Row 011-74 (011 C9, *Hold command*): a lane waiting for the load guard
   * gives way, its instance idle (review 0.1.269, B1); each tier in flight
   * whose runner cancels is cancelled, as the supersession cancel does (C4
   * step 5); a node:test or pytest slot runs its file to its end. Resolves
   * once those tiers ended.
   */
  async #cancelHeld(): Promise<void> {
    this.host.groups.preempt();
    const flights = [...this.host.inFlight.values()].filter((flight) => flight.held !== null);
    for (const { held } of flights) held?.abort("hold" satisfies CancelCause);
    await Promise.all(flights.map((flight) => flight.done));
  }
}

/** The end of a closed switch: a kind no case places does not compile. */
export function unplaced(decision: never): never {
  throw new Error(`squeal scheduler: a decision no carry-out places: ${String(decision)}`);
}
