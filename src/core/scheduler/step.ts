import type { EpochMs } from "../types/common.js";
import type { Revision } from "../types/revision.js";
import type { Admission } from "./admission.js";
import { CAPACITY_RECHECK_MS } from "./capacity.js";
import type { LaneDecision, SlowRun } from "./slow-tier.js";
import { type DecisionAt, inTurn, type SchedulerEvent, type StepDecision } from "./step-events.js";
import type { Idle } from "./tier-plan.js";
import type { Tier } from "./tiers.js";
import { type ReachView, yieldReach } from "./yields.js";

/*
 * Row 011-356 (card 7, `research/scheduler-step.md`, decision 3 and "The
 * step's interface"; `GLOSSARY.md`, "Scheduler step"): the one synchronous
 * decision of what the scheduler does next. It takes the events since the
 * last step, one clock reading and the reads the last step asked for; it
 * returns decisions from a closed list (`StepDecision`) and the next wake.
 * Its rules are `RULES`, one line each, in the written order. It never
 * throws: a port's error ends it with the decisions made before it.
 */

/** A decision of this scheduler's step. */
export type Decision = StepDecision<Tier, SlowRun>;

/** A decision carried out in the step's lock turn, as the step makes it (`DECISION_PLACE`). */
export type TurnDecision = DecisionAt<"turn", Tier, SlowRun>;

/** A decision carried out after the step's lock turn (`DECISION_PLACE`). */
export type AfterDecision = DecisionAt<"after", Tier, SlowRun>;

/** The install stamp read after the last step (`InstallStamps.check`). */
export interface InstallRead {
  readonly stamp: string;
  /** The install is missing: a start fact (`StartFacts.installMissing`). */
  readonly missing: boolean;
  /** It moved since the last read: the keys it moved are refreshed first (task 001-109). */
  readonly changed: boolean;
}

/** The start facts on disk read after the last step (row 011-340). */
export type ProbeRead = "gone" | "held" | "released" | "free";

/**
 * What the step reads that costs I/O, read after the turn that asked for it
 * and kept for the steps of one iteration. `null`: a step outside the
 * pump's iteration, inside another lock turn (a revision's pass, applied
 * runner work, a request) or at a site's event (a hold's start, a flight's
 * end; row 011-366): it runs the rules of `OUTSIDE` only and never starts a
 * tier.
 */
export interface Reads {
  readonly install?: InstallRead;
  readonly probe?: ProbeRead;
  /** The re-walk was asked for a chunk: whether it queued one. */
  readonly rewalk?: boolean;
}

/** What the step asks of the scheduler: its memory and store (live) or a table (tests). */
export interface StepPorts {
  /** Card 5: the admission of the start facts now, stamped with this lock turn. */
  admit(): Admission;
  /** A tier's error stopped the pump until the next batch or request. */
  stalled(): boolean;
  /** The pump was asked for while it ran (`#asked`): a stalled pump runs again. */
  asked(): boolean;
  /** A write gave up on a busy store and none of the pump's landed since (`BusyResume.waiting`). */
  busyWaiting(): boolean;
  /** Runner work queued, and whether it is being applied. */
  runnerWork(): { readonly queued: number; readonly draining: boolean };
  /** Which tier in flight an event names, and whether it stands `named` (`yieldReach`). */
  readonly yields: ReachView;
  /**
   * Card 6: adopts stored results, plans the fast lanes at `at` and starts;
   * `fly` for each tier started.
   */
  startNext(
    admitted: Admission,
    at: EpochMs,
    fly: (tier: Tier) => void,
  ): { readonly idle: Idle | null };
  /**
   * Row 011-357: the slow lane of `group` decides in this lock turn at
   * `at`: its listing, load guard, slot and pick (`SlowTier.decide`); `fly`
   * for the run it starts.
   */
  askLane(group: string, at: EpochMs, fly: (run: SlowRun) => void): LaneDecision;
  /** Why no fast tier starts at `at`: the plan's idle answer when no plan ran. */
  idleNow(at: EpochMs): Idle;
  /** The open slow lanes no tier keeps (`decideRelease`'s `idle`, row 011-355). */
  idleLanes(): readonly string[];
  /** A slow file of `lane` is queued (spec 004 D2). */
  slowQueued(lane: string): boolean;
  /** No batch's tier is left in `lane`, in flight and running (`besideDone`, row 011-269). */
  besideDone(lane: string): boolean;
  /** Queued files wait on other worktrees' claims (task 001-205). */
  claimsWaiting(): boolean;
  /** The pool refused a tier since the last look; the look clears it (row 011-96). */
  refused(): boolean;
  /** The number of tiers in flight. */
  inFlight(): number;
  /** Carries out a decision placed in the lock turn, as the step makes it, at the step's reading `at`. */
  carry(decision: TurnDecision, at: EpochMs): void;
}

/** One step's input (`GLOSSARY.md`, "Scheduler step"). */
export interface Turn {
  /** The one clock reading. */
  readonly at: EpochMs;
  /** The events since the last step, in arrival order; a due wake is a `wake` event. */
  readonly events: readonly SchedulerEvent[];
  readonly reads: Reads | null;
  readonly ports: StepPorts;
}

/**
 * When the loop steps next: `reads`, at once with the reads it asked for;
 * `again`, at once with none; on an `event`; at `at` or on an event; when
 * the claims window ends or on an event; `end`, the pump ends. `turn`: a
 * step outside the pump's iteration, whose caller goes on.
 */
export type NextWake =
  | { readonly kind: "reads" | "again" | "event" | "end" | "turn" }
  | { readonly kind: "at"; readonly at: EpochMs }
  | { readonly kind: "claims"; readonly at: EpochMs };

/** One step's answer. */
export interface Step {
  /** Every decision, in the order made; those placed in the turn were carried out as made. */
  readonly decisions: readonly Decision[];
  readonly wake: NextWake;
  /** The fast start rule ran in this turn: its writes landed (`BusyResume.landed`). */
  readonly selected: boolean;
  /**
   * Row 011-365: a slow lane answered in this turn. The slow release's wake
   * follows: a lane its answer left idle (a load guard's wait that ended)
   * counts toward its close (row 011-211).
   */
  readonly laneAnswered: boolean;
  /** A port's error: the decisions before it stand, and the loop stalls after carrying them out. */
  readonly error: unknown;
}

const END: NextWake = { kind: "end" };
const EVENT: NextWake = { kind: "event" };
const AGAIN: NextWake = { kind: "again" };
const READS: NextWake = { kind: "reads" };
const TURN: NextWake = { kind: "turn" };

/** What the rules of one step share: the decisions so far and the answers of earlier rules. */
class Out {
  readonly decisions: Decision[] = [];
  /** A hold stands: nothing starts, the idle slow lanes close. */
  held = false;
  /** The fast plan ran: its idle answer, `null` when it started none and no plan ran. */
  idle: Idle | null = null;
  selected = false;
  /** A slow lane answered (`Step.laneAnswered`). */
  laneAnswered = false;

  constructor(
    private readonly ports: StepPorts,
    private readonly at: EpochMs,
  ) {}

  /** Row 011-366 (S7): a decision of the turn is carried out at the step's one reading. */
  decide(decision: Decision): void {
    this.decisions.push(decision);
    if (inTurn(decision)) this.ports.carry(decision, this.at);
  }
}

/** A rule: the next wake when it ends the step, else `undefined` and the next rule goes on. */
type Rule = (turn: Turn, out: Out) => NextWake | undefined;

/**
 * The pump's loop ended (its flights and drain too): its note, then, read
 * after it (a daemon may close on it), whether it runs again: not halted,
 * asked or not stalled, and work left or a busy store's wait to end.
 */
const pumpEnded: Rule = ({ events, ports }, out) => {
  if (!events.some((event) => event.kind === "pump-ended")) return undefined;
  const { halts } = ports.admit();
  if (halts.has("reinstalled")) out.decide({ kind: "tell", note: "reinstalled" });
  else if (halts.has("runtime-gone")) out.decide({ kind: "tell", note: "runtime-gone" });
  const rearm = ports.admit();
  const work = rearm.hasWork || ports.busyWaiting();
  return !rearm.halted && (!ports.stalled() || ports.asked()) && work ? AGAIN : END;
};

/**
 * Row 011-366: a command hold began (row 011-74). The tiers in flight whose
 * runner cancels are cancelled, the lanes waiting for a load guard give
 * way, then the pump runs: its step closes the idle slow lanes
 * (`closeSlowLanes`).
 */
const holdBegan: Rule = ({ events }, out) => {
  if (!events.some((event) => event.kind === "hold-began")) return undefined;
  out.decide({ kind: "cancel-held" });
  return AGAIN;
};

/** Whether `events` reach the yield check, and how (row 011-354's `yieldReach`): one check. */
function yieldCheck(turn: Turn, out: Out, events = turn.events): undefined {
  let check = false;
  let adopt = false;
  let trigger: Revision | null = null;
  for (const event of events) {
    const reach = yieldReach(event, turn.ports.yields);
    if (reach.reach === "none") continue;
    check = true;
    if (reach.reach === "adopt-then-check") adopt = true;
    else trigger = reach.trigger ?? trigger;
  }
  if (check) out.decide({ kind: "check-yields", trigger, adopt });
  return undefined;
}

/** A step outside the pump's iteration decided its events' rules: its caller goes on. */
const inTurnEnds: Rule = (turn) => (turn.reads === null ? TURN : undefined);

/** A tier's error stopped the pump, or the daemon stops or its runtime went. */
const stallHolds: Rule = ({ ports }) => (ports.stalled() || ports.admit().halted ? END : undefined);

/** Queued runner work is applied beside the tiers in flight; nothing starts until it is (task 001-140). */
const drainRunnerWork: Rule = ({ ports }, out) => {
  const { queued, draining } = ports.runnerWork();
  if (!draining && queued > 0) out.decide({ kind: "drain" });
  return draining || queued > 0 ? EVENT : undefined;
};

/** No runner call until an install, or none after it went (tasks 001-100, 001-113): the pump ends. */
const installWait: Rule = ({ ports }) => {
  const { halts } = ports.admit();
  return halts.has("install-wait") || halts.has("reinstalled") ? END : undefined;
};

/** At an iteration's first step: no free lane has a file and no lane may be asked. */
const nothingMayStart: Rule = ({ ports, reads }) =>
  reads !== null && Object.keys(reads).length === 0 && !ports.admit().any ? EVENT : undefined;

/** The install stamp before a tier; one that moved refreshes the keys first. */
const readInstallStamp: Rule = ({ reads }, out) => {
  if (reads?.install === undefined) {
    out.decide({ kind: "read-install" });
    return READS;
  }
  if (!reads.install.changed) return undefined;
  out.decide({ kind: "refresh-install" });
  return AGAIN;
};

/** The runtime folder and the merge hold (row 011-340); paths a hold released go first. */
const probeDiskFacts: Rule = ({ reads }, out) => {
  const probe = reads?.probe;
  if (probe === undefined) {
    out.decide({ kind: "read-probe" });
    return READS;
  }
  if (probe === "gone") return END;
  if (probe === "released") {
    out.decide({ kind: "reconcile" });
    return AGAIN;
  }
  out.held = probe === "held";
  return undefined;
};

/**
 * The step that reads the re-walk's answer: its iteration planned and asked
 * the lanes before it asked for the re-walk, so it plans nothing again.
 */
const rewalkRead = (reads: Reads | null) => reads?.rewalk !== undefined;

/**
 * Row 011-366: the one place a missing install is decided (task 001-113):
 * the install went under the scheduler, which stores nothing more. A
 * revision pass's install check found it missing (`install-missing`), or,
 * in the pump's iteration, admission answers it after the holds: the pump
 * ends.
 */
const reinstallMissing: Rule = ({ events, ports, reads }, out) => {
  if (events.some((event) => event.kind === "install-missing")) {
    out.decide({ kind: "reinstall" });
    return TURN;
  }
  if (reads === null || out.held || rewalkRead(reads)) return undefined;
  if (ports.admit().fast !== "install-missing") return undefined;
  // The fast start rule's admission: its writes landed, as when it starts a tier.
  out.selected = true;
  out.decide({ kind: "reinstall" });
  return END;
};

/** Admission, then the tier plan and its act step, in this lock turn (rows 011-340, 011-346). */
const startFastTier: Rule = (turn, out) => {
  const { at, ports, reads } = turn;
  if (out.held || rewalkRead(reads)) return undefined;
  out.selected = true;
  const admitted = ports.admit();
  const fast = admitted.fast;
  if (fast === "held") out.held = true;
  else if (fast === "runner-work") return AGAIN;
  if (fast !== null) return undefined;
  const stamp = reads?.install?.stamp ?? "";
  let started = false;
  const next = ports.startNext(admitted, at, (tier) => {
    started = true;
    out.decide({ kind: "start-tier", tier, stamp, turn: admitted.turn });
    // The batch's tier no longer stands for the work that went beside it (row 011-269).
    const event = {
      kind: "tier-started",
      runId: tier.runId,
      beside: tier.beside === true,
    } as const;
    yieldCheck(turn, out, [event]);
  });
  if (started) return AGAIN;
  out.idle = next.idle;
  return undefined;
};

/**
 * Row 011-357: each slow lane admission asks, in its `ask` order, decides
 * in this turn; one that started a run, or whose queue moved under its
 * pick, plans again. A deferred lane holds back none after it (spec 019
 * D3, review 0.1.396 B1).
 */
const askSlowLanes: Rule = ({ at, ports, reads }, out) => {
  if (out.held || rewalkRead(reads)) return undefined;
  const stamp = reads?.install?.stamp ?? "";
  for (const group of ports.admit().ask) {
    const decided = ports.askLane(group, at, (run) => {
      out.decide({ kind: "start-tier", tier: run.tier, stamp, turn: run.turn, slow: run });
    });
    out.laneAnswered = true;
    if (decided === "started" || decided === "again") return AGAIN;
  }
  return undefined;
};

/**
 * The slow lanes' one close rule (row 011-211, spec 004 D2; row 011-366):
 * a slow run's end closes its lane, still in flight, when a hold stands or
 * no file of it is queued; on a hold the idle lanes close and the pump
 * ends. The close at a lane's bound is its wake owner's (`SlowRelease`).
 */
const closeSlowLanes: Rule = ({ events, ports }, out) => {
  const ended = events.flatMap((event) => (event.kind === "slow-ended" ? [event.lane] : []));
  if (ended.length > 0) {
    const held = ports.admit().halts.has("held");
    const lanes = ended.filter((lane) => held || !ports.slowQueued(lane));
    if (lanes.length > 0) out.decide({ kind: "close-lanes", lanes });
  }
  if (!out.held) return undefined;
  out.decide({ kind: "close-lanes", lanes: ports.idleLanes() });
  return END;
};

/** Row 011-366: a batch's tier or one beside it ended; with no batch left in its lane, its second instance closes (row 011-269). */
const closeBesideLane: Rule = ({ events, ports }, out) => {
  for (const event of events)
    if (event.kind === "beside-ended" && ports.besideDone(event.lane))
      out.decide({ kind: "close-beside", lane: event.lane });
  return undefined;
};

/** Why nothing starts: claims, quiet, the pool, the re-walk, or the next event (row 011-346). */
const idleAnswer: Rule = ({ at, events, reads, ports }, out) => {
  if (reads?.rewalk !== undefined) return reads.rewalk ? AGAIN : END;
  const idle = out.idle ?? ports.idleNow(at);
  if (idle.idle === "claims" || ports.claimsWaiting()) return { kind: "claims", at };
  if (idle.idle === "quiet" && idle.wakeAt !== null) return { kind: "at", at: idle.wakeAt };
  if (ports.refused() || idle.idle === "pool")
    return { kind: "at", at: (at + CAPACITY_RECHECK_MS) as EpochMs };
  if (ports.inFlight() > 0 || events.length > 0) return events.length > 0 ? AGAIN : EVENT;
  out.decide({ kind: "queue-rewalk" });
  return READS;
};

/** The rules, in the written order (`research/scheduler-step.md`, "The step's interface"). */
const RULES: readonly Rule[] = [
  pumpEnded,
  holdBegan,
  yieldCheck,
  stallHolds,
  drainRunnerWork,
  installWait,
  nothingMayStart,
  readInstallStamp,
  probeDiskFacts,
  reinstallMissing,
  startFastTier,
  askSlowLanes,
  closeSlowLanes,
  closeBesideLane,
  idleAnswer,
  inTurnEnds,
];

/**
 * Row 011-366: the rules a step outside the pump's iteration runs (`reads`
 * `null`), in `RULES`' order: its events' own rules, and its caller goes on.
 */
const OUTSIDE: ReadonlySet<Rule> = new Set([
  holdBegan,
  yieldCheck,
  reinstallMissing,
  closeSlowLanes,
  closeBesideLane,
  inTurnEnds,
]);

/** One scheduler step: the rules in order until one names the next wake. Never throws. */
export function step(turn: Turn): Step {
  const out = new Out(turn.ports, turn.at);
  const outside = turn.reads === null;
  const answer = (wake: NextWake, error: unknown): Step => {
    const { decisions, selected, laneAnswered } = out;
    return { decisions, wake, selected, laneAnswered, error };
  };
  try {
    for (const rule of RULES) {
      if (outside && !OUTSIDE.has(rule)) continue;
      const wake = rule(turn, out);
      if (wake !== undefined) return answer(wake, null);
    }
    throw new Error("squeal scheduler: a step ended without a wake");
  } catch (error) {
    return answer(END, error);
  }
}
