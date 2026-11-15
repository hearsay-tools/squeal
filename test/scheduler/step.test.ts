import { describe, expect, it } from "vitest";
import { admit, type StartFacts } from "../../src/core/scheduler/admission.js";
import { CAPACITY_RECHECK_MS } from "../../src/core/scheduler/capacity.js";
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
  queued?: number;
  draining?: boolean;
  tiers?: Tier[];
  named?: string[];
  /** The tiers `startNext` flies, then its idle answer. */
  starts?: Tier[];
  idle?: Idle;
  idleNow?: Idle;
  idleLanes?: string[];
  claims?: boolean;
  refused?: boolean;
  inFlight?: number;
  throws?: keyof StepPorts;
}

function ports(t: Table, log: string[]): StepPorts {
  const thrown = (name: keyof StepPorts) => {
    if (t.throws === name) throw new Error(`${name} failed`);
  };
  return {
    admit: () => admit(facts(t.facts)),
    stalled: () => t.stalled === true,
    runnerWork: () => ({ queued: t.queued ?? 0, draining: t.draining === true }),
    yields: {
      tier: (runId) => t.tiers?.find((x) => x.runId === runId),
      standsNamed: (x) => {
        thrown("yields");
        return t.named?.includes(x.runId) === true;
      },
    },
    startNext: (_admitted, fly) => {
      thrown("startNext");
      for (const x of t.starts ?? []) fly(x);
      return { idle: (t.starts ?? []).length > 0 ? null : (t.idle ?? idle("nothing-queued")) };
    },
    idleNow: () => t.idleNow ?? idle("nothing-queued"),
    idleLanes: () => t.idleLanes ?? [],
    claimsWaiting: () => t.claims === true,
    refused: () => t.refused === true,
    inFlight: () => t.inFlight ?? 0,
    carry: (d) => log.push(`carry ${d.kind}`),
  };
}

const INSTALL = { stamp: "s1", missing: false, changed: false };
const ALL: Reads = { install: INSTALL, probe: "free" };

function run(t: Table, reads: Reads | null = ALL, events: SchedulerEvent[] = []) {
  const log: string[] = [];
  const turn: Turn = { at: AT, events, reads, ports: ports(t, log) };
  const s = step(turn);
  return { ...s, kinds: s.decisions.map((d) => d.kind), log };
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
      const s = run({ idleLanes: ["slow"], starts: [tier("r1")] }, { ...ALL, probe: "held" });
      expect(s.decisions).toEqual([{ kind: "close-lanes", lanes: ["slow"] }]);
      expect(s.wake).toEqual({ kind: "end" });
    });

    it("a hold read in the turn: the same", () => {
      const s = run({ facts: { held: true }, idleLanes: ["slow"] });
      expect([s.kinds, s.wake, s.selected]).toEqual([["close-lanes"], { kind: "end" }, true]);
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

    it("no fast tier starts: the slow lanes are asked with the stamp and the plan's idle answer", () => {
      const s = run({ idle: idle("lane-busy") });
      expect(s.decisions).toEqual([{ kind: "ask-lanes", stamp: "s1", idle: idle("lane-busy") }]);
      expect(s.wake).toEqual({ kind: "reads" });
    });

    it("a lane that started a run begins the next iteration", () => {
      const s = run({}, { ...ALL, lanes: { started: true, idle: null } });
      expect([s.kinds, s.wake]).toEqual([[], { kind: "again" }]);
    });
  });

  describe("each idle wake, once the lanes started nothing", () => {
    const lanesIdle = (plan: Idle | null, t: Table = {}) =>
      run(t, { ...ALL, lanes: { started: false, idle: plan } });

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
      const s = run({ inFlight: 1 }, { ...ALL, lanes: { started: false, idle: null } }, [
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
      const lanes = { started: false, idle: idle("nothing-queued") };
      expect(run({}, { ...ALL, lanes, rewalk: true }).wake).toEqual({ kind: "again" });
      expect(run({}, { ...ALL, lanes, rewalk: false }).wake).toEqual({ kind: "end" });
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

    it("applied runner work and a request taken: a check in their turn", () => {
      for (const kind of ["runner-work-applied", "request-taken"] as const)
        expect(run({}, null, [{ kind }]).decisions).toEqual([check(null, false)]);
    });

    it("a tier started beside the batch's reaches the check; another start does not", () => {
      const beside = tier("r2", { beside: true });
      expect(run({ starts: [beside] }).decisions.map((d) => d.kind)).toEqual([
        "start-tier",
        "check-yields",
      ]);
      expect(run({ starts: [r1] }).kinds).toEqual(["start-tier"]);
    });

    it("R398: a file end of a tier that stands named is checked, stored results first", () => {
      const s = run({ tiers: [r1], named: ["r1"] }, null, [{ kind: "file-ended", runId: "r1" }]);
      expect(s.decisions).toEqual([check(null, true)]);
    });

    it("a file end of a tier whose inputs changed is checked; one of neither is not", () => {
      const changed = tier("r3", { changes: new Map([["f", 2]]) as never });
      const ended = (runId: string) => [{ kind: "file-ended" as const, runId }];
      expect(run({ tiers: [changed] }, null, ended("r3")).decisions).toEqual([check(null, true)]);
      expect(run({ tiers: [r1] }, null, ended("r1")).decisions).toEqual([]);
      expect(run({ tiers: [r1] }, null, ended("gone")).decisions).toEqual([]);
    });

    it("the yield bound's wake adopts first; other wakes and events reach nothing", () => {
      const bound = run({}, null, [{ kind: "wake", reason: "yield-bound" }]);
      expect(bound.decisions).toEqual([check(null, true)]);
      const none: SchedulerEvent[] = [
        { kind: "wake", reason: "claims" },
        { kind: "asked" },
        { kind: "tier-ended", runId: "r1" },
        { kind: "runner-work-drained" },
      ];
      expect(run({}, null, none).decisions).toEqual([]);
    });

    it("several events: one check, adopting first, after the last revision", () => {
      const s = run({ tiers: [r1] }, null, [
        { kind: "revision", revision },
        { kind: "wake", reason: "yield-bound" },
      ]);
      expect(s.decisions).toEqual([check(revision, true)]);
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
      const turn: StepDecisionKind[] = ["start-tier", "check-yields", "reinstall", "drain"];
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
      expect(Object.keys(table)).toHaveLength(11);
    });
  });
});
