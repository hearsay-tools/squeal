import type { EpochMs } from "../types/common.js";
import type { Revision } from "../types/revision.js";
import type { Admission } from "./admission.js";
import { CAPACITY_RECHECK_MS } from "./capacity.js";
import { placeOf, type SchedulerEvent, type StepDecision } from "./step-events.js";
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
export type Decision = StepDecision<Tier, Idle>;

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

/** The slow lanes' answer to `ask-lanes`: one started a run or asks to plan again. */
export interface LanesRead {
  readonly started: boolean;
}

/**
 * What the step reads that costs I/O, read after the turn that asked for it
 * and kept for the steps of one iteration. `null`: a step inside another
 * lock turn (a revision's pass, applied runner work, a request), which
 * decides the yield check only and never starts a tier.
 */
export interface Reads {
  readonly install?: InstallRead;
  readonly probe?: ProbeRead;
  /** Until row 011-357: the slow lanes were asked, and the fast plan's idle answer then. */
  readonly lanes?: LanesRead & { readonly idle: Idle | null };
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
  /** Card 6: adopts stored results, plans the fast lanes and starts; `fly` for each tier started. */
  startNext(admitted: Admission, fly: (tier: Tier) => void): { readonly idle: Idle | null };
  /** Why no fast tier starts, read now: the plan's idle answer when no plan ran. */
  idleNow(): Idle;
  /** The open slow lanes no tier keeps (`decideRelease`'s `idle`, row 011-355). */
  idleLanes(): readonly string[];
  /** Queued files wait on other worktrees' claims (task 001-205). */
  claimsWaiting(): boolean;
  /** The pool refused a tier since the last look; the look clears it (row 011-96). */
  refused(): boolean;
  /** The number of tiers in flight. */
  inFlight(): number;
  /** Carries out a decision placed in the lock turn, as the step makes it. */
  carry(decision: Decision): void;
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
 * step inside another lock turn, whose caller goes on.
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
  /** A port's error: the decisions before it stand, and the loop stalls after carrying them out. */
  readonly error: unknown;
}

const END: NextWake = { kind: "end" };
const EVENT: NextWake = { kind: "event" };
const AGAIN: NextWake = { kind: "again" };
const READS: NextWake = { kind: "reads" };

/** What the rules of one step share: the decisions so far and the answers of earlier rules. */
class Out {
  readonly decisions: Decision[] = [];
  /** A hold stands: nothing starts, the idle slow lanes close. */
  held = false;
  /** The fast plan ran: its idle answer, `null` when it started none and no plan ran. */
  idle: Idle | null = null;
  selected = false;

  constructor(private readonly ports: StepPorts) {}

  decide(decision: Decision): void {
    this.decisions.push(decision);
    if (placeOf(decision) === "turn") this.ports.carry(decision);
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

/** A step inside another lock turn decides the yield check only: its caller's turn goes on. */
const inTurnEnds: Rule = (turn) => (turn.reads === null ? { kind: "turn" } : undefined);

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

/** Admission, then the tier plan and its act step, in this lock turn (rows 011-340, 011-346). */
const startFastTier: Rule = (turn, out) => {
  const { ports, reads } = turn;
  if (out.held || reads?.lanes !== undefined) return undefined;
  out.selected = true;
  const admitted = ports.admit();
  const fast = admitted.fast;
  if (fast === "held") out.held = true;
  else if (fast === "install-missing") out.decide({ kind: "reinstall" });
  else if (fast === "runner-work") return AGAIN;
  if (fast === "install-missing") return END;
  if (fast !== null) return undefined;
  const stamp = reads?.install?.stamp ?? "";
  let started = false;
  const next = ports.startNext(admitted, (tier) => {
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

/** Until row 011-357: each slow lane that may start, in order, asked after the turn. */
const askSlowLanes: Rule = ({ reads }, out) => {
  if (out.held) return undefined;
  const lanes = reads?.lanes;
  if (lanes === undefined) {
    out.decide({ kind: "ask-lanes", stamp: reads?.install?.stamp ?? "", idle: out.idle });
    return READS;
  }
  return lanes.started ? AGAIN : undefined;
};

/** On a hold the idle slow lanes close (row 011-211), and the pump ends. */
const closeSlowLanes: Rule = ({ ports }, out) => {
  if (!out.held) return undefined;
  out.decide({ kind: "close-lanes", lanes: ports.idleLanes() });
  return END;
};

/** Why nothing starts: claims, quiet, the pool, the re-walk, or the next event (row 011-346). */
const idleAnswer: Rule = ({ at, events, reads, ports }, out) => {
  if (reads?.rewalk !== undefined) return reads.rewalk ? AGAIN : END;
  const idle = reads?.lanes?.idle ?? out.idle ?? ports.idleNow();
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
  yieldCheck,
  inTurnEnds,
  stallHolds,
  drainRunnerWork,
  installWait,
  nothingMayStart,
  readInstallStamp,
  probeDiskFacts,
  startFastTier,
  askSlowLanes,
  closeSlowLanes,
  idleAnswer,
];

/** One scheduler step: the rules in order until one names the next wake. Never throws. */
export function step(turn: Turn): Step {
  const out = new Out(turn.ports);
  try {
    for (const rule of RULES) {
      const wake = rule(turn, out);
      if (wake !== undefined)
        return { decisions: out.decisions, wake, selected: out.selected, error: null };
    }
    throw new Error("squeal scheduler: a step ended without a wake");
  } catch (error) {
    return { decisions: out.decisions, wake: END, selected: out.selected, error };
  }
}
