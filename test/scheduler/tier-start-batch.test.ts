import { afterEach, describe, expect, it } from "vitest";
import type { Candidate } from "../../src/core/scheduler/tier-plan.js";
import { startNext } from "../../src/core/scheduler/tier-start.js";
import { executeTier, type TierFile } from "../../src/core/scheduler/tiers.js";
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
 * Row 011-349: the act cases of `pool-wait`, `batch-busy-host`,
 * `batch-select` and `promoted-tier-select`, moved from `selectTier` on a
 * `Ledger` to the act step. What the act step asks the pool for a batch's
 * tier and a backlog's (rows 011-308, 011-309), how a batch's tier refused
 * runs, and what a start counts toward (row 011-268).
 */

afterEach(closeStores);

/** A batch's candidate of `files`: a grant ask that names lane `vitest` and does not wait on a refusal. */
function batch(files: readonly TierFile[]): Candidate {
  return candidate(files, {
    reason: "batch",
    width: { ...ask(files), lane: "vitest", refusalWaits: false },
    promoted: true,
    counts: "batch",
    tookBacklog: false,
  });
}

/** The candidate a refused batch's tier is planned again as (row 011-308). */
function asEdit(files: readonly TierFile[]): Candidate {
  return candidate(files, {
    reason: "batch-as-edit",
    kind: "backlog",
    width: null,
    promoted: true,
    counts: "batch",
    tookBacklog: false,
  });
}

describe("a refused tier and its lane's pool wait (row 011-309, from pool-wait)", () => {
  it("a refused backlog tier waits in its lane; a refused batch's goes on and starts no wait", () => {
    const backlog = setup(null);
    const picked = backlog.files("b");
    const refused = startNext(
      backlog.context,
      backlog.ledger,
      listPlan([candidate(picked, { width: { ...ask(picked), lane: "vitest" } }), IDLE]),
    );
    expect("idle" in refused && refused.idle.idle).toBe("pool");
    expect(backlog.calls.asked).toEqual([{ waitsIn: "vitest", refusalWaits: true }]);

    const named = setup(null);
    const files = named.files("w");
    const started = startNext(named.context, named.ledger, listPlan([batch(files), asEdit(files)]));
    expect("tier" in started && started.tier.promoted).toBe(true);
    // Review 0.1.413 B2: it still names its lane, so a grant there ends the lane's wait.
    expect(named.calls.asked).toEqual([{ waitsIn: "vitest", refusalWaits: false }]);
  });
});

describe("a batch on a busy host (row 011-308, from batch-busy-host)", () => {
  it("runs the refused batch's tier as an edit's: no grant, its workers stated to the pool", async () => {
    const { context, ledger, calls, files, runs } = setup(null);
    const picked = files("w1", "w2", "w3", "w4");
    const result = startNext(context, ledger, listPlan([batch(picked), asEdit(picked)]));
    if (!("tier" in result)) throw new Error("no tier started");
    expect(result.tier.lease).toBeUndefined();
    await executeTier(context, result.tier);
    expect(runs).toEqual([undefined]);
    expect(calls.running).toEqual([4]);
  });
});

describe("what a batch's tier counts toward (row 011-268, from batch-select)", () => {
  it("a batch's start makes the backlog's turn due; the turn's tier that takes the backlog ends it", () => {
    const { context, ledger, files } = setup(8);
    const backlog = files("b1", "b2");
    const wait = files("w1", "w2");
    ledger.queue.promote(
      wait.map((f) => f.file.ref),
      NOW + 60_000,
    );
    const first = startNext(context, ledger, listPlan([batch(wait)]));
    expect(paths(first)).toEqual(["w1", "w2"]);
    expect(ledger.queue.batchTurn()).toBe(true);

    const turn = candidate(backlog, {
      reason: "turn-after-batch",
      kind: "turn",
      tookBacklog: true,
    });
    expect(paths(startNext(context, ledger, listPlan([turn])))).toEqual(["b1", "b2"]);
    expect(ledger.queue.batchTurn()).toBe(false);
  });
});
