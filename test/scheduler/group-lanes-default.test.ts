import { describe, expect, it } from "vitest";
import { readSlowActivity } from "../../src/core/slow/state.js";
import { allCurrent, FILES, groupPolicy, groupSide, tierLog } from "./group-lanes-fixture.js";

/*
 * Spec 019 contracts, "Unchanged without `checks`" (row 019-10): with no
 * `checks` key the default groups give today's lanes and tier order. The
 * logs below were recorded from the scheduler before groups (0.1.395): a
 * start's baseline, then an edit of `src/core.ts`. Slow files run in their
 * runner's lane behind `slow:`, one tier at a time, after the fast files.
 */

const START = {
  vitest: [["test/a.test.ts", "test/b.test.ts"]],
  "node-test": [["nt/test/d.test.mjs"]],
  pytest: [["py/tests/test_f.py"]],
  "slow:vitest": [["test/e2e/c.test.ts"]],
  "slow:node-test": [["ns/test/e.test.mjs"]],
};

const EDIT = {
  vitest: [["test/a.test.ts"]],
  "node-test": [["nt/test/d.test.mjs"]],
  pytest: [["py/tests/test_f.py"]],
  "slow:vitest": [["test/e2e/c.test.ts"]],
  "slow:node-test": [["ns/test/e.test.mjs"]],
};

describe("scheduler lanes with no `checks` key (spec 019 D2, row 019-10)", {
  timeout: 60_000,
}, () => {
  it("gives today's lanes and tier order at a start and after an edit", async () => {
    const { side } = await groupSide(groupPolicy());
    await allCurrent(side);
    expect(tierLog(side.runner.runs)).toEqual(START);
    expect(slowAfterFast(side.runner.runs)).toBe(true);

    const from = side.runner.runs.length;
    await side.edit("watch", "src/core.ts");
    await expect.poll(() => side.runner.runs.length - from, { timeout: 20_000 }).toBe(5);
    await allCurrent(side);
    expect(tierLog(side.runner.runs, from)).toEqual(EDIT);
    expect(slowAfterFast(side.runner.runs.slice(from))).toBe(true);
    expect(readSlowActivity(side.store, side.worktreeId)).toBeNull();
    expect(FILES).toHaveLength(6);
  });

  it("runs a `pytest` entry's files in the slow lane when it has `slow: true` (004 D1, 007 D1)", async () => {
    const { side } = await groupSide(groupPolicy({ pytestSlow: true }));
    await allCurrent(side);
    const log = tierLog(side.runner.runs);
    expect(log["slow:pytest"]).toEqual([["py/tests/test_f.py"]]);
    expect(log.pytest).toBeUndefined();
    expect(slowAfterFast(side.runner.runs)).toBe(true);
  });
});

/** Every slow run started once every fast run before it had ended (004 D2 as amended, 004-60). */
function slowAfterFast(
  runs: readonly { lane: string | undefined; startedAt: number; endedAt: number | null }[],
): boolean {
  const fast = runs.filter((run) => !(run.lane ?? "").startsWith("slow:"));
  const lastFast = Math.max(...fast.map((run) => run.endedAt ?? Number.POSITIVE_INFINITY));
  return runs
    .filter((run) => (run.lane ?? "").startsWith("slow:"))
    .every((run) => run.startedAt >= lastFast);
}
