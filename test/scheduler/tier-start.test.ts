import { afterEach, describe, expect, it } from "vitest";
import type { Idle } from "../../src/core/scheduler/tier-plan.js";
import { startNext } from "../../src/core/scheduler/tier-start.js";
import type { EpochMs } from "../../src/core/types/common.js";
import {
  ask,
  candidate,
  closeStores,
  IDLE,
  listPlan,
  NOW,
  paths,
  setup,
} from "./tier-start-fixture.js";

/*
 * Row 011-346: the tier plan's act step, `startNext`, over a real `Ledger`
 * and a fake pool (`tier-start-fixture.ts`).
 */

afterEach(closeStores);

describe("the tier plan's act step (row 011-346)", () => {
  it("takes the grant and starts the candidate holding the lease", () => {
    const { context, ledger, calls, files } = setup(8);
    const result = startNext(context, ledger, listPlan([candidate(files("a", "b", "c"))]));
    expect(paths(result)).toEqual(["a", "b", "c"]);
    expect("tier" in result && result.tier.lease?.grant).toBe(3);
    expect(calls).toMatchObject({ takes: [3], released: 0 });
  });

  it("a lower grant trims the candidate to the prefix that fits; the rest stays queued", () => {
    const { context, ledger, files } = setup(2);
    const picked = files("a", "b", "c");
    const result = startNext(context, ledger, listPlan([candidate(picked)]));
    expect(paths(result)).toEqual(["a", "b"]);
    expect(ledger.queue.has({ project: "", path: "c" })).toBe(true);
  });

  it("a grant narrower than an edit's tier goes back and the plan's next candidate starts", () => {
    const { context, ledger, calls, files } = setup(2);
    const picked = files("a", "b", "c", "d");
    const plan = listPlan([
      candidate(picked, { width: ask(picked, 4), promoted: true, counts: "batch" }),
      candidate(picked, { reason: "batch-as-edit", width: null, promoted: true, counts: "batch" }),
    ]);
    const result = startNext(context, ledger, plan);
    expect(paths(result)).toEqual(["a", "b", "c", "d"]);
    expect("tier" in result && result.tier.lease).toBeUndefined();
    expect(plan.log).toEqual(["refused narrower"]);
    expect(calls.released).toBe(1);
  });

  it("a refusal takes the next candidate; with none, the answer is the pool's", () => {
    const { context, ledger, files } = setup(null);
    const plan = listPlan([candidate(files("a")), IDLE]);
    const result = startNext(context, ledger, plan);
    expect("idle" in result && result.idle).toEqual({ idle: "pool", at: NOW, wakeAt: NOW + 2_000 });
    expect(plan.log).toEqual(["refused pool"]);
  });

  it("a claim or a wait for quiet the plan answers comes before the pool's refusal", () => {
    const { context, ledger, files } = setup(null);
    const quiet: Idle = { idle: "quiet", at: NOW, wakeAt: (NOW + 300) as EpochMs };
    const result = startNext(context, ledger, listPlan([candidate(files("a")), quiet]));
    expect("idle" in result && result.idle).toEqual(quiet);
  });

  it("the lease goes back when the start throws", () => {
    const { context, ledger, calls, files } = setup(8);
    const picked = files("a");
    context.store.transaction = () => {
      throw new Error("database is locked");
    };
    expect(() => startNext(context, ledger, listPlan([candidate(picked)]))).toThrow(/locked/);
    expect(calls.released).toBe(1);
  });

  it("a start the lookup settled meanwhile asks the plan again", () => {
    const { context, ledger, calls, files } = setup(8);
    const picked = files("a").map((f) => ({ ...f, forced: false }));
    ledger.probe = () => ({ hits: [{} as never], mayWait: false });
    ledger.applyResults = (file) => {
      ledger.queue.remove(file.ref);
    };
    const plan = listPlan([candidate(picked)]);
    const result = startNext(context, ledger, plan);
    expect(paths(result)).toBe("lane-busy");
    expect(plan.log).toEqual(["unstarted a"]);
    expect(calls.released).toBe(1);
  });

  it("checks the lock turn before each start; with fly, flies each and goes on after a slot", () => {
    const { context, ledger, files } = setup(8);
    const [a, b] = [files("a"), files("b")];
    const checked: string[] = [];
    const flown: string[] = [];
    const plan = listPlan([candidate(a ?? []), candidate(b ?? [])]);
    const result = startNext(context, ledger, plan, {
      check: (lane) => checked.push(lane),
      fly: (tier) => flown.push(tier.files[0]?.file.ref.path ?? ""),
    });
    expect(paths(result)).toEqual(["a"]);
    expect([checked, flown]).toEqual([
      ["fast", "fast"],
      ["a", "b"],
    ]);
    expect(plan.log).toEqual(["started a", "started b"]);
  });
});
