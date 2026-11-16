import { describe, expect, it } from "vitest";
import { admit, type StartFacts } from "../../src/core/scheduler/admission.js";
import { CAPACITY_RECHECK_MS } from "../../src/core/scheduler/capacity.js";
import type { LaneDecision, SlowRun } from "../../src/core/scheduler/slow-tier.js";
import {
  type Decision,
  type Reads,
  type StepPorts,
  step,
  type Turn,
} from "../../src/core/scheduler/step.js";
import {
  DECISION_PLACE,
  type DecisionPlace,
  placeOf,
  type SchedulerEvent,
  type StepDecisionKind,
} from "../../src/core/scheduler/step-events.js";
import type { Idle } from "../../src/core/scheduler/tier-plan.js";
import type { Tier } from "../../src/core/scheduler/tiers.js";
import { yieldReach } from "../../src/core/scheduler/yields.js";
import type { EpochMs } from "../../src/core/types/common.js";
import type { Revision } from "../../src/core/types/revision.js";

/*
 * Row 011-356 (card 7, `research/scheduler-step.md`, "The step's interface"
 * and "Tests: replace, don't layer"): the scheduler step over a table
 * adapter. Each row is "these events at this time, these reads, then these
 * decisions and this wake". The live adapter (the scheduler's memory and
 * store) is driven by every scheduler test that runs a real scheduler.
 * Row 011-357: the slow lanes decide in the step's turn, in admission's
 * `ask` order; a lane's own rules are `SlowTier.decide`'s, over a real
 * scheduler (`group-lanes-*`, `slow-*`).
 */

const AT = 1_000_000 as EpochMs;

/** The start facts of a started, free scheduler with nothing queued or in flight. */
function facts(over: Partial<StartFacts> = {}): StartFacts {
  return {
    turn: 7,
    closed: false,
    stopping: false,
    runtimeGone: false,
    started: true,
    awaitingInstall: false,
    reinstalled: false,
    held: false,
    installMissing: false,
    runnerWork: 0,
    refining: false,
    inFlight: [],
    groups: [],
    editQueued: () => false,
    fastQueued: () => false,
    focused: () => false,
    freeLaneQueued: () => false,
    lanes: () => [],
    queued: () => false,
    holdsFollowers: () => false,
    slowWaiting: () => false,
    ...over,
  };
}

const tier = (runId: string, over: Partial<Tier> = {}): Tier =>
  ({
    runId,
    lane: "fast",
    kind: "edit",
    files: [],
    changes: new Map(),
    ...over,
  }) as unknown as Tier;

const idle = (reason: Idle["idle"], wakeAt: number | null = null): Idle => ({
  idle: reason,
  at: AT,
  wakeAt: wakeAt as EpochMs | null,
});

/** A table of what each port answers, and the log of what the step asked and carried. */
interface Table {
  facts?: Partial<StartFacts>;
  stalled?: boolean;
  asked?: boolean;
  busyWaiting?: boolean;
  queued?: number;
  draining?: boolean;
  tiers?: Tier[];
  named?: string[];
  /** The tiers `startNext` flies, then its idle answer (`null`: the plan gave none). */
  starts?: Tier[];
  idle?: Idle | null;
  idleNow?: Idle;
  idleLanes?: string[];
  claims?: boolean;
  refused?: boolean;
  inFlight?: number;
  /** Each slow lane's decision by group (absent: `none`); `start` flies a run of the tier given. */
  lanes?: Record<string, LaneDecision | { start: Tier }>;
  /** The slow lanes with a file queued, and the lanes no batch is left in (row 011-366). */
  slowQueued?: string[];
  besideDone?: string[];
  throws?: keyof StepPorts;
}

/** The configured groups `ask` lists, in order: each has a file queued and none in flight. */
function groups(...names: string[]): Partial<StartFacts> {
  return {
    groups: names.map((name) => ({ name, after: [], limits: { priority: "normal" } })),
    lanes: () => names.map((group) => ({ kind: "local", group })),
    queued: () => true,
  };
}

function ports(t: Table, log: string[], readings: string[] = []): StepPorts {
  const thrown = (name: keyof StepPorts) => {
    if (t.throws === name) throw new Error(`${name} failed`);
  };
  return {
    admit: () => admit(facts(t.facts)),
    stalled: () => t.stalled === true,
    asked: () => t.asked === true,
    busyWaiting: () => t.busyWaiting === true,
    runnerWork: () => ({ queued: t.queued ?? 0, draining: t.draining === true }),
    yields: {
      tier: (runId) => t.tiers?.find((x) => x.runId === runId),
      standsNamed: (x) => {
        thrown("yields");
        return t.named?.includes(x.runId) === true;
      },
    },
    startNext: (_admitted, at, fly) => {
      thrown("startNext");
      readings.push(`plan at ${at - AT}`);
      for (const x of t.starts ?? []) fly(x);
      const answer = t.idle === undefined ? idle("nothing-queued") : t.idle;
      return { idle: (t.starts ?? []).length > 0 ? null : answer };
    },
    askLane: (group, at, fly) => {
      thrown("askLane");
      log.push(`ask ${group} at ${at - AT}`);
      const answer = t.lanes?.[group] ?? "none";
      if (typeof answer !== "object") return answer;
      fly({ tier: answer.start, slot: {}, turn: 7 } as unknown as SlowRun);
      return "started";
    },
    idleNow: (at) => {
      readings.push(`idle at ${at - AT}`);
      return t.idleNow ?? idle("nothing-queued");
    },
    idleLanes: () => t.idleLanes ?? [],
    slowQueued: (lane) => t.slowQueued?.includes(lane) === true,
    besideDone: (lane) => t.besideDone?.includes(lane) === true,
    claimsWaiting: () => t.claims === true,
    refused: () => t.refused === true,
    inFlight: () => t.inFlight ?? 0,
    carry: (d, at) => {
      log.push(`carry ${d.kind}`);
      readings.push(`${d.kind} at ${at - AT}`);
    },
  };
}

const INSTALL = { stamp: "s1", missing: false, changed: false };
const ALL: Reads = { install: INSTALL, probe: "free" };

function run(t: Table, reads: Reads | null = ALL, events: SchedulerEvent[] = []) {
  const log: string[] = [];
  const readings: string[] = [];
  const turn: Turn = { at: AT, events, reads, ports: ports(t, log, readings) };
  const s = step(turn);
  return { ...s, kinds: s.decisions.map((d) => d.kind), log, readings };
}

describe("the scheduler step (row 011-356)", () => {
  describe("an iteration: reads first, then a start", () => {
    it("with no reads, it asks for the install stamp and steps again with it", () => {
      const s = run({ facts: { fastQueued: () => true } }, {});
      expect([s.kinds, s.wake]).toEqual([["read-install"], { kind: "reads" }]);
    });

    it("with the install stamp, it asks for the probe", () => {
      const s = run({}, { install: INSTALL });
      expect([s.kinds, s.wake]).toEqual([["read-probe"], { kind: "reads" }]);
    });

    it("a moved install refreshes the keys first, and the next iteration reads again", () => {
      const s = run({}, { install: { stamp: "s2", missing: false, changed: true } });
      expect([s.kinds, s.wake]).toEqual([["refresh-install"], { kind: "again" }]);
    });

    it("with current reads, a free lane's tier starts in this turn and the next iteration follows", () => {
      const s = run({ starts: [tier("r1")] });
      expect(s.decisions[0]).toMatchObject({ kind: "start-tier", stamp: "s1", turn: 7 });
      expect([s.kinds, s.wake, s.log]).toEqual([
        ["start-tier"],
        { kind: "again" },
        ["carry start-tier"],
      ]);
      expect(s.selected).toBe(true);
    });

    it("no tier starts without reads from the current iteration", () => {
      for (const reads of [{}, { install: INSTALL }, { probe: "free" as const }]) {
        const s = run({ facts: { fastQueued: () => true }, starts: [tier("r1")] }, reads);
        expect(s.kinds).not.toContain("start-tier");
        expect(s.wake).toEqual({ kind: "reads" });
      }
    });

    it("a step inside another lock turn starts nothing and asks for no read", () => {
      const s = run({ starts: [tier("r1")], queued: 2 }, null);
      expect([s.kinds, s.wake]).toEqual([[], { kind: "turn" }]);
    });
  });

  describe("each rule's answer, in the written order", () => {
    it("a stall ends the pump before runner work drains", () => {
      expect(run({ stalled: true, queued: 1 }).wake).toEqual({ kind: "end" });
    });

    it("a stopping daemon or a runtime gone ends the pump, runner work queued or not", () => {
      expect(run({ facts: { stopping: true }, queued: 1 }).kinds).toEqual([]);
      expect(run({ facts: { runtimeGone: true }, starts: [tier("r1")] }).wake).toEqual({
        kind: "end",
      });
    });

    it("queued runner work drains, and the pump waits for its end", () => {
      const s = run({ queued: 1, starts: [tier("r1")] });
      expect([s.kinds, s.wake]).toEqual([["drain"], { kind: "event" }]);
    });

    it("runner work being applied: no second drain, the pump waits", () => {
      const s = run({ draining: true });
      expect([s.kinds, s.wake]).toEqual([[], { kind: "event" }]);
    });

    it("an install wait or a reinstall ends the pump", () => {
      expect(run({ facts: { awaitingInstall: true } }).wake).toEqual({ kind: "end" });
      expect(run({ facts: { reinstalled: true } }).wake).toEqual({ kind: "end" });
    });

    it("at an iteration's first step, nothing may start: the pump waits for an event", () => {
      const busy = { inFlight: [{ lane: "fast", edit: true }] };
      const s = run({ facts: busy }, {});
      expect([s.kinds, s.wake]).toEqual([[], { kind: "event" }]);
    });

    it("the probe: a runtime gone ends the pump; released paths reconcile first", () => {
      expect(run({}, { ...ALL, probe: "gone" }).wake).toEqual({ kind: "end" });
      const s = run({}, { ...ALL, probe: "released" });
      expect([s.kinds, s.wake]).toEqual([["reconcile"], { kind: "again" }]);
    });

    it("a hold on disk closes the idle slow lanes and ends the pump, no lane asked", () => {
      const t = { facts: groups("a"), idleLanes: ["slow"], starts: [tier("r1")] };
      const s = run(t, { ...ALL, probe: "held" });
      expect(s.decisions).toEqual([{ kind: "close-lanes", lanes: ["slow"] }]);
      expect([s.wake, s.log]).toEqual([{ kind: "end" }, []]);
    });

    it("a hold read in the turn: the same", () => {
      const s = run({ facts: { ...groups("a"), held: true }, idleLanes: ["slow"] });
      expect([s.kinds, s.wake, s.selected]).toEqual([["close-lanes"], { kind: "end" }, true]);
      expect(s.log).toEqual([]);
    });

    it("an install found missing reinstalls in this turn and ends the pump", () => {
      const s = run({ facts: { installMissing: true } });
      expect([s.kinds, s.wake, s.log]).toEqual([
        ["reinstall"],
        { kind: "end" },
        ["carry reinstall"],
      ]);
    });

    it("runner work queued in the turn: the next iteration drains it", () => {
      const s = run({ facts: { runnerWork: 1 }, starts: [tier("r1")] });
      expect([s.kinds, s.wake]).toEqual([[], { kind: "again" }]);
    });
  });

  describe("the slow lanes decide in the step's turn (row 011-357)", () => {
    it("no fast tier starts: each lane is asked in admission's order, at the step's reading", () => {
      const s = run({ facts: groups("a", "b", "slow"), idle: idle("lane-busy"), inFlight: 1 });
      expect(s.log).toEqual(["ask a at 0", "ask b at 0", "ask slow at 0"]);
      // None started: the plan's idle answer stands.
      expect([s.kinds, s.wake]).toEqual([[], { kind: "event" }]);
    });

    it("a lane's run starts in this turn with the iteration's stamp, and the next iteration follows", () => {
      const r2 = tier("r2", { lane: "group:b:vitest" });
      const s = run({ facts: groups("a", "b", "c"), lanes: { b: { start: r2 } } });
      expect(s.decisions).toEqual([
        {
          kind: "start-tier",
          tier: r2,
          stamp: "s1",
          turn: 7,
          slow: { tier: r2, slot: {}, turn: 7 },
        },
      ]);
      // Carried as the lane decided it, before the step returns; the lane after it waits.
      expect([s.log, s.wake]).toEqual([
        ["ask a at 0", "ask b at 0", "carry start-tier"],
        { kind: "again" },
      ]);
    });

    it("a deferred lane does not hold back the next", () => {
      const r2 = tier("r2", { lane: "group:b:vitest" });
      const s = run({ facts: groups("a", "b"), lanes: { a: "deferred", b: { start: r2 } } });
      expect([s.kinds, s.log]).toEqual([
        ["start-tier"],
        ["ask a at 0", "ask b at 0", "carry start-tier"],
      ]);
    });

    it("every lane deferred or waiting: the idle answer, no lane asked twice", () => {
      const lanes = { a: "deferred", b: "none" } as const;
      const s = run({ facts: groups("a", "b"), lanes, idle: idle("quiet", AT + 900) });
      expect([s.log, s.wake]).toEqual([["ask a at 0", "ask b at 0"], { kind: "at", at: AT + 900 }]);
    });

    it("a lane whose queue moved under its pick plans again; the lanes after it wait", () => {
      const s = run({ facts: groups("a", "b"), lanes: { a: "again" } });
      expect([s.kinds, s.log, s.wake]).toEqual([[], ["ask a at 0"], { kind: "again" }]);
    });

    it("admission's `ask` leaves out a lane whose tier is in flight", () => {
      const busy = { ...groups("a", "b"), inFlight: [{ lane: "group:a:vitest", edit: false }] };
      expect(run({ facts: busy, inFlight: 1 }).log).toEqual(["ask b at 0"]);
    });

    it("a fast tier that starts asks no lane in its turn", () => {
      expect(run({ facts: groups("a"), starts: [tier("r1")] }).log).toEqual(["carry start-tier"]);
    });

    it("no lane is asked without reads from the current iteration, nor in another lock turn", () => {
      for (const reads of [{}, { install: INSTALL }, null]) {
        const s = run({ facts: { ...groups("a"), fastQueued: () => true } }, reads);
        expect(s.log).toEqual([]);
      }
    });

    it("the step that reads the re-walk's answer plans nothing and asks no lane again", () => {
      const t = { facts: groups("a"), starts: [tier("r1")] };
      for (const rewalk of [true, false]) {
        const s = run(t, { ...ALL, rewalk });
        expect([s.kinds, s.log]).toEqual([[], []]);
      }
    });

    it("a lane's decision that throws ends the step with its error", () => {
      const s = run({ facts: groups("a"), throws: "askLane" });
      expect([s.kinds, s.wake, String(s.error)]).toEqual([
        [],
        { kind: "end" },
        "Error: askLane failed",
      ]);
    });
  });

  describe("the pump's end", () => {
    const ended = (t: Table) => run(t, {}, [{ kind: "pump-ended" }]);

    it("with work left it runs again; with none it rests", () => {
      expect(ended({ facts: { fastQueued: () => true } }).wake).toEqual({ kind: "again" });
      expect(ended({}).wake).toEqual({ kind: "end" });
    });

    it("a stall rests until asked; a busy store's wait runs it once with nothing queued", () => {
      const work = { facts: { runnerWork: 1 }, stalled: true };
      expect(ended(work).wake).toEqual({ kind: "end" });
      expect(ended({ ...work, asked: true }).wake).toEqual({ kind: "again" });
      expect(ended({ busyWaiting: true }).wake).toEqual({ kind: "again" });
    });

    it("a reinstall or a runtime gone tells its note in this turn and rests", () => {
      const reinstalled = ended({ facts: { reinstalled: true, fastQueued: () => true } });
      expect([reinstalled.decisions, reinstalled.wake, reinstalled.log]).toEqual([
        [{ kind: "tell", note: "reinstalled" }],
        { kind: "end" },
        ["carry tell"],
      ]);
      const gone = ended({ facts: { runtimeGone: true } });
      expect(gone.decisions).toEqual([{ kind: "tell", note: "runtime-gone" }]);
    });
  });

  describe("each idle wake, once the lanes started nothing", () => {
    /** `plan`: the fast plan's idle answer; `null`, it gave none. */
    const lanesIdle = (plan: Idle | null, t: Table = {}) => run({ ...t, idle: plan });

    it("claims: the claims window", () => {
      expect(lanesIdle(idle("claims")).wake).toEqual({ kind: "claims", at: AT });
      expect(lanesIdle(idle("lane-busy"), { claims: true }).wake).toEqual({
        kind: "claims",
        at: AT,
      });
    });

    it("quiet: at the plan's absolute wake", () => {
      expect(lanesIdle(idle("quiet", AT + 900)).wake).toEqual({ kind: "at", at: AT + 900 });
    });

    it("pool, or a refusal since the last look: after the capacity recheck", () => {
      const at = AT + CAPACITY_RECHECK_MS;
      expect(lanesIdle(idle("pool", AT + 5)).wake).toEqual({ kind: "at", at });
      expect(lanesIdle(idle("lane-busy"), { refused: true }).wake).toEqual({ kind: "at", at });
    });

    it("lane busy with a tier in flight: the next event", () => {
      expect(lanesIdle(idle("lane-busy"), { inFlight: 1 }).wake).toEqual({ kind: "event" });
    });

    it("an event since the last step: the next iteration at once", () => {
      const s = run({ inFlight: 1, idle: idle("lane-busy") }, ALL, [
        { kind: "tier-ended", runId: "r0" },
      ]);
      expect(s.wake).toEqual({ kind: "again" });
    });

    it("nothing queued or in flight: the re-walk is asked for a chunk", () => {
      const s = lanesIdle(idle("nothing-queued"));
      expect([s.kinds, s.wake]).toEqual([["queue-rewalk"], { kind: "reads" }]);
    });

    it("no plan ran: the idle answer read now", () => {
      expect(lanesIdle(null, { idleNow: idle("quiet", AT + 40) }).wake).toEqual({
        kind: "at",
        at: AT + 40,
      });
    });

    it("the re-walk's answer: a chunk queued begins the next iteration, none ends the pump", () => {
      expect(run({}, { ...ALL, rewalk: true }).wake).toEqual({ kind: "again" });
      expect(run({}, { ...ALL, rewalk: false }).wake).toEqual({ kind: "end" });
    });
  });

  describe("the yield check", () => {
    const r1 = tier("r1");
    const revision = { number: 4 } as Revision;
    const check = (trigger: Revision | null, adopt: boolean) => ({
      kind: "check-yields",
      trigger,
      adopt,
    });

    it("a revision's step decides the check in its turn, after the revision", () => {
      const s = run({ tiers: [r1] }, null, [{ kind: "revision", revision }]);
      expect([s.decisions, s.wake, s.log]).toEqual([
        [check(revision, false)],
        { kind: "turn" },
        ["carry check-yields"],
      ]);
    });

    it("several events: one check, adopting first, after the last revision", () => {
      const s = run({ tiers: [r1] }, null, [
        { kind: "revision", revision },
        { kind: "wake", reason: "yield-bound" },
      ]);
      expect(s.decisions).toEqual([check(revision, true)]);
    });
  });

  describe("row 011-366: the decisions of a step outside the pump's iteration", () => {
    const lane = (kind: "slow-ended" | "beside-ended", name: string): SchedulerEvent => ({
      kind,
      lane: name,
    });

    it("a command hold's start cancels the held tiers after its turn, then the pump runs", () => {
      const s = run({}, null, [{ kind: "hold-began" }]);
      expect([s.kinds, s.log, s.wake]).toEqual([["cancel-held"], [], { kind: "again" }]);
    });

    it("a slow run's end closes its lane when no file of it is queued, after the turn", () => {
      const s = run({ slowQueued: ["other"] }, null, [lane("slow-ended", "slow")]);
      expect([s.decisions, s.log, s.wake]).toEqual([
        [{ kind: "close-lanes", lanes: ["slow"] }],
        [],
        { kind: "turn" },
      ]);
    });

    it("a slow run's end with a file of its lane queued: the lane stays open, unless a hold stands", () => {
      const ended = [lane("slow-ended", "slow")];
      expect(run({ slowQueued: ["slow"] }, null, ended).decisions).toEqual([]);
      const held = run({ slowQueued: ["slow"], facts: { held: true } }, null, ended);
      expect(held.decisions).toEqual([{ kind: "close-lanes", lanes: ["slow"] }]);
    });

    it("a revision pass's missing install: the step reinstalls in its turn", () => {
      const s = run({}, null, [{ kind: "install-missing" }]);
      expect([s.kinds, s.log, s.wake]).toEqual([
        ["reinstall"],
        ["carry reinstall"],
        { kind: "turn" },
      ]);
    });

    it("a batch's flight end closes the lane's second instance once no batch is left there", () => {
      const ended = [lane("beside-ended", "fast")];
      expect(run({ besideDone: ["fast"] }, null, ended).decisions).toEqual([
        { kind: "close-beside", lane: "fast" },
      ]);
      expect(run({ besideDone: [] }, null, ended).decisions).toEqual([]);
    });

    it("no pump rule runs: a stall, queued runner work and a hold decide nothing there", () => {
      const t: Table = { stalled: true, queued: 2, facts: { held: true }, idleLanes: ["g"] };
      const s = run(t, null, [{ kind: "request-taken" }, lane("beside-ended", "fast")]);
      expect([s.kinds, s.wake]).toEqual([["check-yields"], { kind: "turn" }]);
    });
  });

  describe("row 011-366 (S7): the step's one reading", () => {
    it("reaches the fast plan, each tier's start and the yield check of a tier beside the batch's", () => {
      const s = run({ starts: [tier("b", { beside: true })] });
      expect(s.readings).toEqual(["plan at 0", "start-tier at 0", "check-yields at 0"]);
    });

    it("reaches the idle answer read when no plan ran, and a revision's yield check in its pass", () => {
      expect(run({ idle: null }).readings).toEqual(["plan at 0", "idle at 0"]);
      const revision = { number: 3 } as unknown as Revision;
      expect(run({}, null, [{ kind: "revision", revision }]).readings).toEqual([
        "check-yields at 0",
      ]);
    });
  });

  describe("a port that throws", () => {
    it("ends the step with its error; the decisions made before it stand", () => {
      const s = run({ throws: "startNext" }, ALL, [{ kind: "request-taken" }]);
      expect(s.kinds).toEqual(["check-yields"]);
      expect([s.wake, String(s.error)]).toEqual([{ kind: "end" }, "Error: startNext failed"]);
    });

    it("a failing read of the tiers in flight: no decision, the error", () => {
      const s = run({ tiers: [tier("r1")], throws: "yields" }, null, [
        { kind: "file-ended", runId: "r1" },
      ]);
      expect([s.kinds, String(s.error)]).toEqual([[], "Error: yields failed"]);
    });
  });

  describe("closed lists", () => {
    it("each decision kind is placed in the turn or after it", () => {
      const turn: StepDecisionKind[] = ["start-tier", "check-yields", "tell", "reinstall", "drain"];
      for (const [kind, place] of Object.entries(DECISION_PLACE))
        expect([kind, place]).toEqual([
          kind,
          turn.includes(kind as StepDecisionKind) ? "turn" : "after",
        ]);
    });

    it("an unplaced decision or event kind does not compile", () => {
      const placed = (decision: Decision): DecisionPlace => placeOf(decision);
      // @ts-expect-error: a decision kind with no place in `DECISION_PLACE` is no decision
      expect(placed({ kind: "flush" })).toBeUndefined();
      const reach = { tier: () => undefined, standsNamed: () => false };
      // @ts-expect-error: an event kind `yieldReach` does not place is no event
      expect(() => yieldReach({ kind: "rumour" }, reach)).toThrow(/does not place/);
      const table: Record<StepDecisionKind, DecisionPlace> = DECISION_PLACE;
      expect(Object.keys(table)).toHaveLength(13);
    });
  });
});
