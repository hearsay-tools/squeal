import { describe, expect, it } from "vitest";
import { readGroupActivity } from "../../src/core/slow/state.js";
import type { CheckGroup } from "../../src/core/types/check-groups.js";
import {
  allCurrent,
  GROUP_RECHECK_MS,
  groupPolicy,
  groupSide,
  tierLog,
} from "./group-lanes-fixture.js";
import { settle } from "./tier-yields-fixture.js";

/*
 * Spec 019 D3 (review 0.1.396 B1, row 019-20): one group's load guard wait
 * never holds back another group's lane. Each lane waits for its own bound
 * while the pump asks the other lanes; a lane whose bound the load passes
 * runs at once. Row 011-368: the scheduler's clock is virtual; a recheck
 * and the 5 s bound come only when the test moves it, and each check reads
 * at the side's quiet point (`settle`).
 */

const C = "test/e2e/c.test.ts";
const B = "test/b.test.ts";

const MAX_DEFER_MS = 5_000;

/** A group at `edit` of `tests`, with a load guard of `maxLoadPerCpu` and `MAX_DEFER_MS`. */
function guarded(name: string, tests: string, maxLoadPerCpu: number): CheckGroup {
  return {
    name,
    runner: "vitest",
    tests: [tests],
    at: "edit",
    limits: { deferUnderLoad: { maxLoadPerCpu, maxDeferMs: MAX_DEFER_MS } },
  };
}

const STRICT = guarded("strict", C, 1);
const TOLERANT = guarded("tolerant", B, 20);

const started = () => groupSide(groupPolicy({ checks: [STRICT, TOLERANT] }), { clock: "virtual" });

describe("load guards of two groups (spec 019 D3, review 0.1.396 B1)", { timeout: 60_000 }, () => {
  it("runs a group its own bound lets through while another group waits for the load", async () => {
    const { side, setLoad } = await started();
    await allCurrent(side);
    setLoad(10);
    const from = side.runner.runs.length;
    await side.edit("watch", "src/core.ts", "src/other.ts");
    await settle(side);
    expect(readGroupActivity(side.store, side.worktreeId, "strict")).toEqual({
      kind: "waiting",
      for: "load",
    });
    expect(tierLog(side.runner.runs, from)["group:tolerant:vitest"]).toEqual([[B]]);
    expect(tierLog(side.runner.runs, from)["group:strict:vitest"]).toBeUndefined();
    // 1 ms before its own `maxDeferMs` the strict group still waits; at it, it runs under the load.
    side.advance(MAX_DEFER_MS - 1);
    await settle(side);
    expect(tierLog(side.runner.runs, from)["group:strict:vitest"]).toBeUndefined();
    expect(readGroupActivity(side.store, side.worktreeId, "strict")).toEqual({
      kind: "waiting",
      for: "load",
    });
    side.advance(1);
    await settle(side);
    expect(tierLog(side.runner.runs, from)["group:strict:vitest"]).toEqual([[C]]);
  });

  it("runs a second lane that becomes eligible while the first stays deferred", async () => {
    const { side, setLoad } = await started();
    await allCurrent(side);
    setLoad(30);
    const from = side.runner.runs.length;
    await side.edit("watch", "src/core.ts", "src/other.ts");
    await settle(side);
    for (const group of ["strict", "tolerant"]) {
      expect(readGroupActivity(side.store, side.worktreeId, group)).toEqual({
        kind: "waiting",
        for: "load",
      });
    }
    // The load falls below the tolerant group's bound only: its next recheck runs it.
    setLoad(10);
    side.advance(GROUP_RECHECK_MS);
    await settle(side);
    expect(tierLog(side.runner.runs, from)["group:tolerant:vitest"]).toEqual([[B]]);
    expect(tierLog(side.runner.runs, from)["group:strict:vitest"]).toBeUndefined();
    expect(readGroupActivity(side.store, side.worktreeId, "strict")).toEqual({
      kind: "waiting",
      for: "load",
    });
    setLoad(0);
    side.advance(GROUP_RECHECK_MS);
    await allCurrent(side);
    expect(tierLog(side.runner.runs, from)["group:strict:vitest"]).toEqual([[C]]);
  });

  it("runs a lane whose files a later edit queued while the first stays deferred", async () => {
    const { side, setLoad } = await started();
    await allCurrent(side);
    setLoad(10);
    const from = side.runner.runs.length;
    await side.edit("watch", "src/core.ts");
    await settle(side);
    expect(readGroupActivity(side.store, side.worktreeId, "strict")).toEqual({
      kind: "waiting",
      for: "load",
    });
    await side.edit("watch", "src/other.ts");
    await settle(side);
    expect(tierLog(side.runner.runs, from)["group:tolerant:vitest"]).toEqual([[B]]);
    expect(tierLog(side.runner.runs, from)["group:strict:vitest"]).toBeUndefined();
    setLoad(0);
    side.advance(GROUP_RECHECK_MS);
    await allCurrent(side);
  });
});
