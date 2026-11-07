import { setTimeout as delay } from "node:timers/promises";
import { describe, expect, it } from "vitest";
import { readGroupActivity } from "../../src/core/slow/state.js";
import type { CheckGroup } from "../../src/core/types/check-groups.js";
import { allCurrent, groupPolicy, groupSide, tierLog } from "./group-lanes-fixture.js";

/*
 * Spec 019 D3 (review 0.1.396 B1, row 019-20): one group's load guard wait
 * never holds back another group's lane. Each lane waits for its own bound
 * while the pump asks the other lanes; a lane whose bound the load passes
 * runs at once.
 */

const C = "test/e2e/c.test.ts";
const B = "test/b.test.ts";

/** A group at `edit` of `tests`, with a load guard of `maxLoadPerCpu` and 5 s. */
function guarded(name: string, tests: string, maxLoadPerCpu: number): CheckGroup {
  return {
    name,
    runner: "vitest",
    tests: [tests],
    at: "edit",
    limits: { deferUnderLoad: { maxLoadPerCpu, maxDeferMs: 5_000 } },
  };
}

const STRICT = guarded("strict", C, 1);
const TOLERANT = guarded("tolerant", B, 20);

describe("load guards of two groups (spec 019 D3, review 0.1.396 B1)", { timeout: 60_000 }, () => {
  it("runs a group its own bound lets through while another group waits for the load", async () => {
    const { side, setLoad } = await groupSide(groupPolicy({ checks: [STRICT, TOLERANT] }));
    await allCurrent(side);
    setLoad(10);
    const from = side.runner.runs.length;
    await side.edit("watch", "src/core.ts", "src/other.ts");
    await expect
      .poll(() => readGroupActivity(side.store, side.worktreeId, "strict"), { timeout: 20_000 })
      .toEqual({ kind: "waiting", for: "load" });
    await expect
      .poll(() => tierLog(side.runner.runs, from)["group:tolerant:vitest"], { timeout: 1_000 })
      .toEqual([[B]]);
    expect(tierLog(side.runner.runs, from)["group:strict:vitest"]).toBeUndefined();
    expect(readGroupActivity(side.store, side.worktreeId, "strict")).toEqual({
      kind: "waiting",
      for: "load",
    });
    // At its own `maxDeferMs` the strict group runs under the load.
    await expect
      .poll(() => tierLog(side.runner.runs, from)["group:strict:vitest"], { timeout: 20_000 })
      .toEqual([[C]]);
  });

  it("runs a second lane that becomes eligible while the first stays deferred", async () => {
    const { side, setLoad } = await groupSide(groupPolicy({ checks: [STRICT, TOLERANT] }));
    await allCurrent(side);
    setLoad(30);
    const from = side.runner.runs.length;
    await side.edit("watch", "src/core.ts", "src/other.ts");
    for (const group of ["strict", "tolerant"]) {
      await expect
        .poll(() => readGroupActivity(side.store, side.worktreeId, group), { timeout: 20_000 })
        .toEqual({ kind: "waiting", for: "load" });
    }
    // The load falls below the tolerant group's bound only: its next recheck runs it.
    setLoad(10);
    await expect
      .poll(() => tierLog(side.runner.runs, from)["group:tolerant:vitest"], { timeout: 1_000 })
      .toEqual([[B]]);
    await delay(200);
    expect(tierLog(side.runner.runs, from)["group:strict:vitest"]).toBeUndefined();
    expect(readGroupActivity(side.store, side.worktreeId, "strict")).toEqual({
      kind: "waiting",
      for: "load",
    });
    setLoad(0);
    await allCurrent(side);
    expect(tierLog(side.runner.runs, from)["group:strict:vitest"]).toEqual([[C]]);
  });

  it("runs a lane whose files a later edit queued while the first stays deferred", async () => {
    const { side, setLoad } = await groupSide(groupPolicy({ checks: [STRICT, TOLERANT] }));
    await allCurrent(side);
    setLoad(10);
    const from = side.runner.runs.length;
    await side.edit("watch", "src/core.ts");
    await expect
      .poll(() => readGroupActivity(side.store, side.worktreeId, "strict"), { timeout: 20_000 })
      .toEqual({ kind: "waiting", for: "load" });
    await side.edit("watch", "src/other.ts");
    await expect
      .poll(() => tierLog(side.runner.runs, from)["group:tolerant:vitest"], { timeout: 2_000 })
      .toEqual([[B]]);
    expect(tierLog(side.runner.runs, from)["group:strict:vitest"]).toBeUndefined();
    setLoad(0);
    await allCurrent(side);
  });
});
