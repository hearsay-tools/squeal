import { describe, expect, it } from "vitest";
import {
  type Admission,
  admit,
  checkTurn,
  type GroupFact,
  HALT_REASONS,
  type HaltReason,
  type StartFacts,
} from "../../src/core/scheduler/admission.js";
import { Mutex } from "../../src/core/scheduler/mutex.js";

/*
 * Row 011-340 (research/admission.md): the one admission answer, a table
 * over start facts in memory. No scheduler, store or timer: each row names
 * the facts that differ from an idle, started daemon with nothing queued.
 * The scheduler and its slow lanes call this same `admit`.
 */

const FAST = "vitest";
const SLOW_LANE = "slow:vitest";
const LINT_LANE = "group:lint:vitest";
const E2E_LANE = "group:e2e:vitest";

const group = (
  name: string,
  after: readonly string[] = [],
  priority: "normal" | "low" = "normal",
): GroupFact => ({ name, after, limits: { priority } });

/** `tests`; `lint` normal after nothing; `e2e` low after `tests`; the default `slow` low after `tests`. */
const GROUPS: readonly GroupFact[] = [
  group("tests"),
  group("lint"),
  group("e2e", ["tests"], "low"),
  group("slow", ["tests"], "low"),
];

/** An idle, started daemon's facts, with `overrides`. */
function facts(overrides: Partial<StartFacts> = {}): StartFacts {
  return {
    turn: 1,
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
    groups: GROUPS,
    editQueued: () => false,
    fastQueued: () => false,
    focused: () => false,
    freeLaneQueued: () => false,
    lanes: () => ["lint", "e2e", "slow"].map((name) => ({ kind: "local", group: name })),
    queued: () => false,
    holdsFollowers: () => false,
    slowWaiting: () => false,
    ...overrides,
  };
}

/** Every halt reason's fact set. */
const HALT_FACTS: Record<HaltReason, Partial<StartFacts>> = {
  stopping: { stopping: true },
  "runtime-gone": { runtimeGone: true },
  "not-started": { started: false },
  "install-wait": { awaitingInstall: true },
  reinstalled: { reinstalled: true },
  held: { held: true },
  "install-missing": { installMissing: true },
};

const tier = (lane: string, edit = false) => ({ lane, edit });

/** A fact that answers `value` and logs each read of it in `read`. */
const logged =
  (read: string[], value: boolean) =>
  (name = "activity"): boolean => {
    read.push(name);
    return value;
  };

describe("admission: why no lane starts (row 011-340)", () => {
  it.each(HALT_REASONS)("halts on %s alone", (reason) => {
    const answer = admit(facts(HALT_FACTS[reason]));
    expect(answer.halt).toBe(reason);
    expect([...answer.halts]).toEqual([reason]);
  });

  it("names the first reason in the pump's order under the lock", () => {
    // Each reason with every later one: the earlier wins.
    HALT_REASONS.forEach((reason, i) => {
      const all = Object.assign({}, ...HALT_REASONS.slice(i).map((later) => HALT_FACTS[later]));
      expect(admit(facts({ ...all, runnerWork: 1 })).fast).toBe(reason);
    });
  });

  it("halts the pump, the group lanes and the re-walk only when stopping or the runtime went", () => {
    for (const reason of HALT_REASONS) {
      const halted = reason === "stopping" || reason === "runtime-gone";
      expect(admit(facts(HALT_FACTS[reason])).halted, reason).toBe(halted);
    }
  });

  it("starts no fast tier while runner work is pending, after every halt", () => {
    expect(admit(facts({ runnerWork: 2 })).fast).toBe("runner-work");
    expect(admit(facts({ runnerWork: 2, held: true })).fast).toBe("held");
    // A refinement in flight is not runner work the pump waits for (`RunnerWork.size`).
    expect(admit(facts({ refining: true })).fast).toBeNull();
    expect(admit(facts()).fast).toBeNull();
  });
});

describe("admission: the lanes the pump asks (row 011-340)", () => {
  it("asks every lane with nothing in flight, queued or not", () => {
    const answer = admit(facts());
    expect(answer.ask).toEqual(["lint", "e2e", "slow"]);
    expect(answer.any).toBe(true);
  });

  it("asks a lane with files queued and no tier of its group in flight", () => {
    const answer = admit(
      facts({ inFlight: [tier(FAST)], queued: (name) => name === "lint" || name === "e2e" }),
    );
    expect(answer.asked("lint")).toBeNull();
    expect(answer.asked("e2e")).toBeNull();
    expect(answer.asked("slow")).toEqual({ reason: "nothing-queued" });
    expect(answer.ask).toEqual(["lint", "e2e"]);
  });

  it("asks no lane whose group has a tier in flight", () => {
    const answer = admit(facts({ inFlight: [tier(LINT_LANE)], queued: () => true }));
    expect(answer.asked("lint")).toEqual({ reason: "lane-busy" });
    expect(answer.ask).toEqual(["e2e", "slow"]);
  });

  it("asks no lane after `tests` while an edit's work is pending", () => {
    const edit = admit(facts({ inFlight: [tier(FAST, true)], queued: () => true }));
    expect(edit.asked("e2e")).toEqual({ reason: "after-tests" });
    expect(edit.asked("lint")).toBeNull();
    // The backlog's tier is no edit's work: the lane is asked, and waits itself.
    const backlog = admit(facts({ inFlight: [tier(FAST)], queued: () => true }));
    expect(backlog.asked("e2e")).toBeNull();
  });

  it("is `any` with a fast file in a free lane, else with a lane to ask", () => {
    const busy = { inFlight: [tier(FAST)] };
    expect(admit(facts(busy)).any).toBe(false);
    expect(admit(facts({ ...busy, freeLaneQueued: () => true })).any).toBe(true);
    expect(admit(facts({ ...busy, queued: (name) => name === "slow" })).any).toBe(true);
  });

  it("asks no lane before start", () => {
    const answer = admit(facts({ groups: null, inFlight: [tier(FAST)], queued: () => true }));
    expect(answer.ask).toEqual([]);
    expect(answer.any).toBe(false);
  });
});

/** The lane's answer with the load guard's `idle` and no open request. */
const lane = (answer: Admission, name: string, idle = true, requested = false) =>
  answer.lane(name, { idle, requested });

describe("admission: a group lane's answer under the lock (row 011-340)", () => {
  it("refuses on stopping, the runtime gone and a hold, in that order", () => {
    expect(lane(admit(facts({ held: true, runtimeGone: true })), "lint").refusal).toEqual({
      reason: "runtime-gone",
    });
    expect(lane(admit(facts({ held: true })), "lint").refusal).toEqual({ reason: "held" });
    expect(lane(admit(facts({ stopping: true })), "lint").refusal).toEqual({
      reason: "stopping",
    });
  });

  it("waits for `tests` while an edit's work is pending, a request open or not", () => {
    for (const edit of [{ runnerWork: 1 }, { editQueued: () => true }, { focused: () => true }]) {
      const answer = admit(facts(edit));
      expect(lane(answer, "e2e", true, true).waits).toEqual({ reason: "after-tests" });
      // Runner work refuses every lane first (row 011-341).
      const refusal = "runnerWork" in edit ? "runner-work" : "after-tests";
      expect(lane(answer, "e2e", true, true).refusal).toEqual({ reason: refusal });
    }
  });

  it("waits for the fast backlog unless a request is open (004-60)", () => {
    const backlog = admit(facts({ fastQueued: () => true }));
    expect(lane(backlog, "slow").waits).toEqual({ reason: "after-tests" });
    expect(lane(backlog, "slow", true, true).waits).toBeNull();
    const running = admit(facts({ inFlight: [tier(FAST)] }));
    expect(lane(running, "slow").waits).toEqual({ reason: "after-tests" });
    expect(lane(running, "slow", true, true).refusal).toBeNull();
  });

  it("waits for a group `after` names while it holds (019 D1)", () => {
    const groups = [...GROUPS, group("docs", ["lint"])];
    const queued = admit(facts({ groups, holdsFollowers: (name) => name === "lint" }));
    expect(lane(queued, "docs").waits).toEqual({ reason: "after-group", group: "lint" });
    const flying = admit(facts({ groups, inFlight: [tier(LINT_LANE)] }));
    expect(lane(flying, "docs").refusal).toEqual({ reason: "after-group", group: "lint" });
  });

  it("does not wait for a commit group's files no commit asked for (019-26)", () => {
    // `holdsFollowers` is the lane's own: false while only unasked files are queued.
    const groups = [...GROUPS, group("docs", ["lint"])];
    const answer = admit(facts({ groups, queued: (name) => name === "lint" }));
    expect(lane(answer, "docs").refusal).toBeNull();
  });
});

describe("admission: a group lane's width (row 011-340, written once)", () => {
  it("is wide for a normal group, whatever the load or other work", () => {
    const busy = admit(facts({ runnerWork: 1, inFlight: [tier(LINT_LANE)] }));
    expect(lane(busy, "lint", false).width).toBe("wide");
  });

  it("is wide for a low group on an idle machine with no normal work", () => {
    expect(lane(admit(facts()), "e2e").width).toBe("wide");
  });

  it("is one file for a low group under load", () => {
    expect(lane(admit(facts()), "e2e", false).width).toBe("one");
  });

  it("is one file for a low group while fast work is pending", () => {
    expect(lane(admit(facts({ fastQueued: () => true })), "slow").width).toBe("one");
  });

  it("is one file for a low group while a normal group holds (019 D3)", () => {
    expect(lane(admit(facts({ inFlight: [tier(LINT_LANE)] })), "e2e").width).toBe("one");
    const queued = admit(facts({ holdsFollowers: (name) => name === "lint" }));
    expect(lane(queued, "e2e").width).toBe("one");
  });

  it("is wide for a low group beside a commit group's unasked file (019-27)", () => {
    // The `lint` lane's `holdsFollowers` is false for a file no commit asked for.
    const answer = admit(facts({ queued: (name) => name === "lint" }));
    expect(lane(answer, "e2e").width).toBe("wide");
  });

  it("does not read the low groups' holds", () => {
    const read: string[] = [];
    const answer = admit(facts({ holdsFollowers: logged(read, false) }));
    expect(lane(answer, "e2e").width).toBe("wide");
    expect(read).toEqual(["lint"]);
  });
});

describe("admission: costly facts read lazily, at most once (row 011-340)", () => {
  it("reads no group's holds while fast work is pending", () => {
    const read: string[] = [];
    const answer = admit(facts({ fastQueued: () => true, holdsFollowers: logged(read, true) }));
    expect(answer.normalIdle).toBe(false);
    expect(read).toEqual([]);
  });

  it("reads each group's holds and the stored activity once per answer", () => {
    const read: string[] = [];
    const answer = admit(
      facts({
        holdsFollowers: logged(read, false),
        slowWaiting: logged(read, false),
      }),
    );
    for (let i = 0; i < 3; i++) {
      void answer.normalIdle;
      void lane(answer, "e2e").width;
      void answer.rewalk;
    }
    expect(read).toEqual(["lint", "activity"]);
  });
});

describe("admission: the re-walk, the re-arm and the status answers (row 011-340)", () => {
  it("gives way to the default slow lane's waiting file", () => {
    expect(admit(facts()).rewalk).toBeNull();
    expect(admit(facts({ slowWaiting: () => true })).rewalk).toEqual({ reason: "files-waiting" });
  });

  it("takes no chunk once stopping or the runtime went, before reading the activity", () => {
    const slowWaiting = () => {
      throw new Error("read");
    };
    expect(admit(facts({ stopping: true, slowWaiting })).rewalk).toEqual({ reason: "stopping" });
    expect(admit(facts({ runtimeGone: true, slowWaiting })).rewalk).toEqual({
      reason: "runtime-gone",
    });
  });

  it("has only runner work as work on hold", () => {
    expect(admit(facts({ held: true, fastQueued: () => true })).hasWork).toBe(false);
    expect(admit(facts({ held: true, runnerWork: 1 })).hasWork).toBe(true);
    expect(admit(facts({ fastQueued: () => true })).hasWork).toBe(true);
    expect(admit(facts({ focused: () => true })).hasWork).toBe(true);
    expect(admit(facts()).hasWork).toBe(false);
  });

  it("has no work while it waits for an install or after a reinstall", () => {
    expect(admit(facts({ awaitingInstall: true, runnerWork: 1 })).hasWork).toBe(false);
    expect(admit(facts({ reinstalled: true, fastQueued: () => true })).hasWork).toBe(false);
  });

  it("answers status while stopping but not closed, and not on hold", () => {
    expect(admit(facts({ stopping: true })).quiet).toBe(false);
    expect(admit(facts({ stopping: true, closed: true })).quiet).toBe(true);
    expect(admit(facts({ held: true })).quiet).toBe(true);
  });

  it("counts an edit's tier in flight as an edit's work, a backlog's or a lane's not", () => {
    expect(admit(facts({ inFlight: [tier(FAST, true)] })).editPending).toBe(true);
    expect(admit(facts({ inFlight: [tier(FAST)], refining: true })).editPending).toBe(true);
    expect(admit(facts({ inFlight: [tier(FAST), tier(SLOW_LANE)] })).editPending).toBe(false);
    expect(admit(facts({ inFlight: [tier(SLOW_LANE), tier(E2E_LANE)] })).fastIdle).toBe(true);
    expect(admit(facts({ inFlight: [tier(FAST)] })).fastIdle).toBe(false);
  });
});

describe("admission: pinned differences between the copies (research/admission.md)", () => {
  it("difference 1, row 011-341: no lane starts while runner work is pending, `after` or not", () => {
    const answer = admit(facts({ runnerWork: 1, queued: () => true }));
    expect(answer.fast).toBe("runner-work");
    for (const name of ["lint", "e2e", "slow"]) {
      expect(lane(answer, name, true, true).refusal).toEqual({ reason: "runner-work" });
    }
    // A halt goes first, in the pump's order.
    const held = admit(facts({ runnerWork: 1, held: true }));
    expect(lane(held, "lint").refusal).toEqual({ reason: "held" });
  });

  it("difference 2, row 011-342: the re-walk gives way to any lane's waiting files", () => {
    // `slowWaiting` reads every lane's stored activity, a configured group's too (`#facts`);
    // the scheduler's test is `admission-rewalk-lanes.test.ts`. A queued file that waits for
    // nothing stored, here lint's, leaves the re-walk free.
    const lint = (name: string) => name === "lint";
    expect(admit(facts({ queued: lint, slowWaiting: () => true })).rewalk).toEqual({
      reason: "files-waiting",
    });
    expect(admit(facts({ queued: lint })).rewalk).toBeNull();
  });
});

describe("admission: the lock turn stamp (row 011-340)", () => {
  it("carries the turn it was read in, on the answer and each lane's", () => {
    const answer = admit(facts({ turn: 7 }));
    expect(answer.turn).toBe(7);
    expect(lane(answer, "lint").turn).toBe(7);
  });

  it("acts on an answer in the turn it was read in", async () => {
    const lock = new Mutex(() => Date.now());
    await lock.run(() => {
      const answer = admit(facts({ turn: lock.turn }));
      expect(() => checkTurn(answer, lock.turn, "vitest")).not.toThrow();
    });
  });

  it("throws on an answer read in one lock turn and acted on in the next", async () => {
    const lock = new Mutex(() => Date.now());
    const answer = await lock.run(() => admit(facts({ turn: lock.turn })));
    await lock.run(() => {
      expect(() => checkTurn(answer, lock.turn, "slow:vitest")).toThrow(
        "an admission read in lock turn 1 was acted on in lock turn 2, lane slow:vitest",
      );
    });
  });

  it("counts one turn per task, also for a task that fails", async () => {
    const lock = new Mutex(() => Date.now());
    expect(lock.turn).toBe(0);
    await lock.run(() => {});
    await lock.run(() => Promise.reject(new Error("no"))).catch(() => {});
    await lock.run(() => {});
    expect(lock.turn).toBe(3);
  });
});
