// Throwaway probe (001-84): races between a pull and the push channel, run
// against this checkout's real store, state sink and delivery. Nothing here is
// product code. `confirmPull` is the candidate rule: when PostToolBatch finds an
// intact pull block in a tool result, write into the consumer's view what the
// pull read, as a delivery of those states would, never over a newer entry.
import { beforeEach, describe, expect, it } from "vitest";
import { createDelivery, planDelta } from "../../../../../../../src/core/delivery/index.js";
import { checkIdentity, createStateSink } from "../../../../../../../src/core/state/index.js";
import type {
  Consumer,
  HarnessDelivery,
  KnownState,
  ResultRecord,
  StateSink,
  Store,
} from "../../../../../../../src/core/types/index.js";
import { fixedStatus } from "../../../../../../../test/delivery/fakes.js";
import { check, freshStore, result, setKey, WT } from "../../../../../../../test/state/helpers.js";

const MAIN: Consumer = { worktreeId: WT, sessionId: "s1", agentId: "main" };
const SUB: Consumer = { worktreeId: WT, sessionId: "s1", agentId: "sub-1" };
const A = check("a");
const B = check("b");
const NONE = { checkpointId: null };

let store: Store;
let sink: StateSink;
let delivery: HarnessDelivery;
let clock: number;
let revision: number;

beforeEach(() => {
  store = freshStore();
  clock = 10_000;
  revision = 0;
  sink = createStateSink(store, { now: () => clock });
  delivery = createDelivery(store, { status: fixedStatus(), now: () => clock, pollIntervalMs: 5 });
  setKey(store, "k1");
});

function apply(...results: ResultRecord[]) {
  revision++;
  clock += 100;
  sink.applyResults(WT, revision, results, NONE);
}

/** What `status --wait` reads and prints: the known states at one instant. */
interface Pull {
  readonly states: readonly KnownState[];
  readonly readAt: number;
}
function pull(): Pull {
  clock += 100;
  return { states: store.knownStates.list(WT), readAt: clock };
}

/** Candidate rule: the pull as a delivery of what it read, guarded by `toldAt`. */
function confirmPull(consumer: Consumer, p: Pull, guard = true): void {
  store.transaction(() => {
    const view = store.views.list(consumer);
    const toldAt = new Map(view.map((v) => [checkIdentity(v.check), v.toldAt]));
    const plan = planDelta({
      view,
      states: p.states,
      isBaselineFinding: () => false,
      toldAt: p.readAt,
      rootOf: () => null,
      revision,
    });
    const writes = guard
      ? plan.writes.filter((w) => (toldAt.get(checkIdentity(w.check)) ?? 0) < p.readAt)
      : plan.writes;
    store.views.writeMany(consumer, writes); // removals ignored: status never prints a retirement
  });
}

/** The naive rule: advance the view to the current known states when the hook runs. */
function advanceToCurrent(consumer: Consumer): void {
  confirmPull(consumer, { states: store.knownStates.list(WT), readAt: clock + 1 }, false);
}

async function push(consumer: Consumer): Promise<string[] | null> {
  clock += 100;
  const delta = await delivery.onToolBoundary(consumer);
  return delta === null ? null : delta.entries.map((e) => `${e.check.fullName}:${e.kind}`);
}

const fail = (c = A, message = "expected 1 to be 2") => result(c, "fail", { message });

describe("pull-advances-push probe", () => {
  it("today: a push repeats a failure the pull already printed", async () => {
    await delivery.register(MAIN);
    apply(fail());
    const p = pull();
    expect(p.states.map((s) => s.outcome)).toEqual(["fail"]);
    expect(await push(MAIN)).toEqual(["a:first-seen-fail"]);
  });

  it("confirmed pull: no repeat, and a transition after the pull's read still arrives", async () => {
    await delivery.register(MAIN);
    apply(fail());
    const p = pull();
    apply(result(A, "fail", { message: "expected 1 to be 2" }), fail(B)); // B breaks after the read
    confirmPull(MAIN, p);
    expect(await push(MAIN)).toEqual(["b:first-seen-fail"]);
  });

  it("race 1, naive: advancing to the current states at hook time loses that transition", async () => {
    await delivery.register(MAIN);
    apply(fail());
    pull();
    apply(fail(), fail(B));
    advanceToCurrent(MAIN);
    expect(await push(MAIN)).toBeNull(); // B was never printed and is never pushed
  });

  it("race 2, unguarded: a push between the pull's read and its confirmation is rolled back and repeated", async () => {
    await delivery.register(MAIN);
    apply(fail(A, "one"));
    const p = pull();
    apply(fail(A, "two"));
    expect(await push(MAIN)).toEqual(["a:first-seen-fail"]); // the waiter told "two"
    confirmPull(MAIN, p, false);
    expect(await push(MAIN)).toEqual(["a:fail-changed"]); // unguarded: "two" told again
  });

  it("race 2, guarded: the newer entry stays", async () => {
    await delivery.register(MAIN);
    apply(fail(A, "one"));
    const p = pull();
    apply(fail(A, "two"));
    expect(await push(MAIN)).toEqual(["a:first-seen-fail"]);
    confirmPull(MAIN, p);
    expect(await push(MAIN)).toBeNull();
  });

  it("race 3: two pulls confirmed out of order, guarded, leave the newer read", async () => {
    await delivery.register(MAIN);
    apply(fail());
    const older = pull();
    apply(result(A, "pass"));
    const newer = pull();
    confirmPull(MAIN, newer);
    confirmPull(MAIN, older);
    expect(store.views.list(MAIN).map((v) => v.outcome)).toEqual(["pass"]);
    expect(await push(MAIN)).toBeNull();
  });

  it("race 4: a subagent's pull credited to the main agent (session-only identity) loses news", async () => {
    await delivery.register(MAIN);
    await delivery.register(SUB);
    apply(fail());
    const p = pull(); // run by the subagent; main never sees its output
    confirmPull(MAIN, p);
    expect(await push(MAIN)).toBeNull(); // main is never told A fails
    expect(await push(SUB)).toEqual(["a:first-seen-fail"]); // and the subagent hears it twice
  });

  it("race 4, keyed by the hook's agent_id: each consumer keeps its own news", async () => {
    await delivery.register(MAIN);
    await delivery.register(SUB);
    apply(fail());
    confirmPull(SUB, pull());
    expect(await push(SUB)).toBeNull();
    expect(await push(MAIN)).toEqual(["a:first-seen-fail"]);
  });

  it("a recovery shown only as absence from the failure list counts as told", async () => {
    await delivery.register(MAIN);
    apply(fail());
    await push(MAIN);
    apply(result(A, "pass"));
    confirmPull(MAIN, pull());
    expect(await push(MAIN)).toBeNull(); // the fail -> pass push is consumed by the pull
  });
});
