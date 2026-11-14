import type { CheckPriority, ResolvedGroup } from "../types/check-groups.js";
import { isGroupLane, laneGroup, TESTS_GROUP } from "../types/scheduler.js";

/*
 * Row 011-340 (research/admission.md, GLOSSARY "Start facts", "Admission"):
 * the one answer to "may a tier start in this lane now, one file or
 * several, and if not, why". The scheduler reads the start facts from
 * memory (`#facts`), and the pump, the slow lanes, the import re-walk and
 * the status answers act on `admit`'s answer. Pure: no I/O, no timers, no
 * store writes, and it never throws. The facts that cost a read are read
 * when an answer first needs them, at most once per answer.
 */

/** Why no lane starts, in the pump's order under the lock. */
export const HALT_REASONS = [
  "stopping",
  "runtime-gone",
  "not-started",
  "install-wait",
  "reinstalled",
  "held",
  "install-missing",
] as const;

export type HaltReason = (typeof HALT_REASONS)[number];

/**
 * Why no tier starts in a lane, or no chunk of the re-walk is taken: a
 * halt, runner work, then the lane's own rules.
 */
export type Refusal =
  | { readonly reason: HaltReason | "runner-work" | "after-tests" | "lane-busy" }
  | { readonly reason: "nothing-queued" | "files-waiting" }
  | { readonly reason: "after-group"; readonly group: string };

/** A tier in flight: its lane, and whether it is an edit's (not the backlog's, not a group lane's). */
export interface FlightFact {
  readonly lane: string;
  readonly edit: boolean;
}

/** What admission reads of a group (spec 019 D1, D3). */
export type GroupFact = Pick<ResolvedGroup, "name" | "after"> & {
  readonly limits: { readonly priority: CheckPriority };
};

/** A group's lane, in `GroupTiers.lanes` order. A remote kind comes later (card 10). */
export interface LaneFact {
  readonly kind: "local";
  readonly group: string;
}

/** The start facts, as known at one moment (GLOSSARY "Start facts"). */
export interface StartFacts {
  /** The lock turn they were read in (`Mutex.turn`). */
  readonly turn: number;
  readonly closed: boolean;
  /** The close began, or the daemon's stop (row 011-66). */
  readonly stopping: boolean;
  /** The daemon's own runtime went (row 011-106). */
  readonly runtimeGone: boolean;
  readonly started: boolean;
  /** No runner call until an install (task 001-100). */
  readonly awaitingInstall: boolean;
  /** The install went under this scheduler (task 001-113). */
  readonly reinstalled: boolean;
  /** Either hold holds (011 C9, "Holds"; rows 011-72, 011-74). */
  readonly held: boolean;
  /** The pump's last install check found it missing (task 001-113). */
  readonly installMissing: boolean;
  /** Runner work queued, not applied yet (`RunnerWork.size`). */
  readonly runnerWork: number;
  /** A refinement is being applied (`RunnerWork.refining`). */
  readonly refining: boolean;
  readonly inFlight: readonly FlightFact[];
  /** The policy's groups, in its order; `null` before start. */
  readonly groups: readonly GroupFact[] | null;
  /** A recent fast file of an edit is queued (`queue.hasFirstGroup`). */
  editQueued(): boolean;
  /** A fast file is queued; during a drain, only the drain's (row 011-93). */
  fastQueued(): boolean;
  /** A focused entry waits for its tier (row 011-145). */
  focused(): boolean;
  /** A fast file whose lane may take a tier is queued, or one a tier beside a batch's takes. */
  freeLaneQueued(): boolean;
  /** Each group's lane, in `GroupTiers.lanes` order. */
  lanes(): readonly LaneFact[];
  /** A file of group `name` is queued. */
  queued(name: string): boolean;
  /** Group `name` has a queued file that holds its followers (`SlowTier.holdsFollowers`, row 019-26). */
  holdsFollowers(name: string): boolean;
  /** A group lane's stored activity is "waiting", the default `slow` group's or a configured one's (spec 004 D8, row 011-342). */
  slowWaiting(): boolean;
}

/** A lane's own state: its open `run --slow` request, and whether its load guard found the machine idle. */
export interface LaneLoad {
  readonly requested: boolean;
  readonly idle: boolean;
}

/** A group lane's answer, read under the lock before its tier starts. */
export interface LaneAnswer {
  readonly turn: number;
  readonly group: string;
  /** Why no tier starts in the lane now; `null` when one may. */
  readonly refusal: Refusal | null;
  /** The groups `after` names that go first (spec 019 D1); `null` when none holds. */
  readonly waits: Refusal | null;
  /** Several files (up to the group's full width) or one (spec 004 D2, 019 D3). */
  readonly width: "one" | "wide";
}

/** The admission of every lane under `facts`. */
export function admit(facts: StartFacts): Admission {
  return new Admission(facts);
}

/**
 * Row 011-340: a tier starts only on an answer read in the lock turn it
 * starts in, so a fact read before a wait cannot start a tier after it.
 */
export function checkTurn(answer: { readonly turn: number }, turn: number, lane: string): void {
  if (answer.turn === turn) return;
  throw new Error(
    `squeal scheduler: an admission read in lock turn ${answer.turn} was acted on in lock turn ${turn}, lane ${lane}`,
  );
}

/** The answer for every lane at one moment (GLOSSARY "Admission"). */
export class Admission {
  readonly #facts: StartFacts;
  /** Every reason no lane starts that holds. */
  readonly halts: ReadonlySet<HaltReason>;
  /** Each costly fact and derived flag, read once per answer. */
  readonly #read = new Map<string, boolean>();

  constructor(facts: StartFacts) {
    this.#facts = facts;
    const holding: Record<HaltReason, boolean> = {
      stopping: facts.stopping,
      "runtime-gone": facts.runtimeGone,
      "not-started": !facts.started,
      "install-wait": facts.awaitingInstall,
      reinstalled: facts.reinstalled,
      held: facts.held,
      "install-missing": facts.installMissing,
    };
    this.halts = new Set(HALT_REASONS.filter((reason) => holding[reason]));
  }

  get turn(): number {
    return this.#facts.turn;
  }

  /** The first reason no lane starts, in `HALT_REASONS` order; `null` when none. */
  get halt(): HaltReason | null {
    return HALT_REASONS.find((reason) => this.halts.has(reason)) ?? null;
  }

  /** The daemon stops or its runtime went: the pump ends, no lane is asked, no chunk taken. */
  get halted(): boolean {
    return this.#facts.stopping || this.#facts.runtimeGone;
  }

  /** Before the lock, with tiers in flight: a free lane has a file, or a lane may be asked. */
  get any(): boolean {
    const facts = this.#facts;
    if (facts.inFlight.length === 0 || facts.freeLaneQueued()) return true;
    return facts.groups !== null && facts.lanes().some(({ group }) => this.asked(group) === null);
  }

  /** The fast lanes' answer under the lock: a halt, `runner-work`, or `null` to select. */
  get fast(): HaltReason | "runner-work" | null {
    return this.halt ?? (this.#facts.runnerWork > 0 ? "runner-work" : null);
  }

  /** The group lanes the pump asks, in `GroupTiers.lanes` order. */
  get ask(): readonly string[] {
    if (this.#facts.groups === null) return [];
    const groups = this.#facts.lanes().map(({ group }) => group);
    return groups.filter((group) => this.asked(group) === null);
  }

  /**
   * Nothing in flight (the pump then also ends a drained pass), or files of
   * the group queued and no tier of it in flight (one at a time per group,
   * whatever its runner), nor an edit's work while it follows `tests`
   * (spec 004 D2, 019 D1). Groups that follow no `tests` start beside fast
   * work (019 D3).
   */
  asked(name: string): Refusal | null {
    if (this.#facts.inFlight.length === 0) return null;
    const group = this.#group(name);
    const queued =
      group !== undefined && this.#once(`queued:${name}`, () => this.#facts.queued(name));
    if (group === undefined || !queued) return { reason: "nothing-queued" };
    if (this.#inFlightOf(name)) return { reason: "lane-busy" };
    const editFirst = group.after.includes(TESTS_GROUP) && this.editPending;
    return editFirst ? { reason: "after-tests" } : null;
  }

  /** Group `name`'s lane under the lock, with its own request and load. */
  lane(name: string, load: LaneLoad): LaneAnswer {
    const answer = this;
    let waits: { readonly value: Refusal | null } | null = null;
    const waitsOnce = () => {
      waits ??= { value: answer.#waits(name, load) };
      return waits.value;
    };
    return {
      turn: this.turn,
      group: name,
      get refusal() {
        return answer.#laneHalt() ?? waitsOnce();
      },
      get waits() {
        return waitsOnce();
      },
      get width() {
        return answer.#width(name, load) ? "wide" : "one";
      },
    };
  }

  /** The import re-walk's answer (row 015-117); `null` when it may take a chunk. */
  get rewalk(): Refusal | null {
    const { stopping, runtimeGone } = this.#facts;
    if (stopping || runtimeGone) return { reason: stopping ? "stopping" : "runtime-gone" };
    const waiting = this.#once("slow-waiting", () => this.#facts.slowWaiting());
    return waiting ? { reason: "files-waiting" } : null;
  }

  /** The status answers say nothing: closed, or on hold (011 C9, row 011-72). */
  get quiet(): boolean {
    return this.#facts.closed || this.#facts.held;
  }

  /**
   * An edit's fast work goes before a slow file (spec 004 D2 as amended):
   * runner work, a refinement in flight included, a recent fast file queued,
   * a focused entry, or an edit's tier in flight, the backlog's turn included.
   */
  get editPending(): boolean {
    return this.#once("edit-pending", () => {
      const facts = this.#facts;
      if (facts.runnerWork > 0 || facts.refining || facts.editQueued()) return true;
      if (facts.focused()) return true;
      return facts.inFlight.some(({ edit }) => edit);
    });
  }

  /**
   * No fast work pending or running: an idle slow tier may take several
   * files (D2). During a drain, the paused backlog is not pending (row 011-93).
   */
  get fastIdle(): boolean {
    return this.#once("fast-idle", () => {
      const facts = this.#facts;
      if (facts.runnerWork > 0 || facts.refining || facts.fastQueued()) return false;
      if (facts.focused()) return false;
      return facts.inFlight.every(({ lane }) => isGroupLane(lane));
    });
  }

  /**
   * `fastIdle`, and no group of `normal` priority other than `tests` has
   * work in flight or queued work that runs without a further ask (spec 019
   * D3): a `low` group's lane then may take several files. A `commit`
   * group's file no commit asked for leaves the width (row 019-27). Before
   * start it is `fastIdle`.
   */
  get normalIdle(): boolean {
    return this.#once("normal-idle", () => {
      if (!this.fastIdle) return false;
      return (this.#facts.groups ?? []).every(
        (group) =>
          group.name === TESTS_GROUP ||
          group.limits.priority !== "normal" ||
          !this.#groupHolds(group.name),
      );
    });
  }

  /**
   * Never while waiting or reinstalled, so the pump cannot re-arm into a wait
   * (review wave 11c, B1). On hold the runner part goes on and the queue
   * waits (row 011-72).
   */
  get hasWork(): boolean {
    const facts = this.#facts;
    if (facts.awaitingInstall || facts.reinstalled) return false;
    if (facts.held) return facts.runnerWork > 0;
    return facts.runnerWork > 0 || facts.fastQueued() || facts.focused();
  }

  /**
   * A lane's halts under the lock, in the pump's order: a lane reads no
   * install fact (the pump did). No lane starts while runner work is
   * pending (row 011-341): its keys would come from a revision the runner
   * has not invalidated yet, whatever the group's `after`.
   */
  #laneHalt(): Refusal | null {
    const facts = this.#facts;
    if (facts.stopping) return { reason: "stopping" };
    if (facts.runtimeGone) return { reason: "runtime-gone" };
    if (facts.held) return { reason: "held" };
    return facts.runnerWork > 0 ? { reason: "runner-work" } : null;
  }

  /**
   * The groups `after` names go first (spec 019 D1): a group's while it has
   * a file that holds its followers or a tier in flight. For `tests`, an
   * edit's fast work always (004 D2 as amended 2026-10-09), and any fast
   * work unless a request is open (task 004-60).
   */
  #waits(name: string, load: LaneLoad): Refusal | null {
    for (const first of this.#group(name)?.after ?? []) {
      if (first !== TESTS_GROUP) {
        if (this.#groupHolds(first)) return { reason: "after-group", group: first };
      } else if (this.editPending || (!load.requested && !this.fastIdle)) {
        return { reason: "after-tests" };
      }
    }
    return null;
  }

  /** A `normal` group's width, or a `low` one's on an idle machine with no `normal` work (019 D3). */
  #width(name: string, load: LaneLoad): boolean {
    const priority = this.#group(name)?.limits.priority;
    return priority === "normal" || (priority === "low" && load.idle && this.normalIdle);
  }

  #group(name: string): GroupFact | undefined {
    return this.#facts.groups?.find((group) => group.name === name);
  }

  #inFlightOf(name: string): boolean {
    return this.#facts.inFlight.some(({ lane }) => laneGroup(lane) === name);
  }

  /** Group `name` has a tier in flight, or a queued file that holds its followers (row 019-26). */
  #groupHolds(name: string): boolean {
    if (this.#inFlightOf(name)) return true;
    return this.#once(`holds:${name}`, () => this.#facts.holdsFollowers(name));
  }

  #once(key: string, read: () => boolean): boolean {
    let value = this.#read.get(key);
    if (value === undefined) {
      value = read();
      this.#read.set(key, value);
    }
    return value;
  }
}
