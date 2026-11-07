import { readdirSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { describe, expect, it } from "vitest";
import { readDaemonNotes } from "../../src/core/notes.js";
import { readGroupActivity, readSlowActivity } from "../../src/core/slow/state.js";
import type { CheckGroup } from "../../src/core/types/check-groups.js";
import type { CatchUpRun } from "./catch-up-fixture.js";
import { allCurrent, groupPolicy, groupSide, ranPaths, tierLog } from "./group-lanes-fixture.js";

/*
 * Spec 019 Testing, "Scheduler" (row 019-10): a group without limits takes
 * no load guard and no shared slot; a group with `limits` honours each;
 * `after` holds a group until its predecessors settle; a long group's
 * running tier does not delay another lane.
 */

const C = "test/e2e/c.test.ts";
const B = "test/b.test.ts";

/** A gate for the runs `holds` picks: they wait until `open`. */
function gate(
  side: { runner: { holdOf: ((run: CatchUpRun) => Promise<void> | undefined) | null } },
  holds: (run: CatchUpRun) => boolean,
) {
  let open = () => {};
  const shut = new Promise<void>((resolve) => {
    open = resolve;
  });
  side.runner.holdOf = (run) => (holds(run) ? shut : undefined);
  return { open: () => open() };
}

describe("group limits (spec 019 D3, row 019-10)", { timeout: 60_000 }, () => {
  it("runs a group without limits under load and with no slot, while the slow group waits for the load", async () => {
    const e2e: CheckGroup = { name: "e2e", runner: "vitest", tests: [C], at: "edit" };
    const { side, slotDir, setLoad } = await groupSide(groupPolicy({ checks: [e2e] }));
    await allCurrent(side);
    setLoad(10);
    const from = side.runner.runs.length;
    await side.edit("watch", "src/core.ts");
    await expect
      .poll(() => tierLog(side.runner.runs, from)["group:e2e:vitest"], { timeout: 20_000 })
      .toEqual([[C]]);
    // The default `slow` group keeps today's guard (004 D3): its file waits for the load.
    await expect
      .poll(() => readSlowActivity(side.store, side.worktreeId), { timeout: 20_000 })
      .toEqual({ kind: "waiting", for: "load" });
    expect(tierLog(side.runner.runs, from)["slow:node-test"]).toBeUndefined();
    expect(readdirSync(slotDir).filter((name) => name.startsWith("group.e2e."))).toEqual([]);
    // The e2e lane is independent of the slow lane's wait: its run may still be
    // in flight here, so wait for it to end before reading its activity (review 0.1.396-r2 N1).
    await expect
      .poll(() => readGroupActivity(side.store, side.worktreeId, "e2e"), { timeout: 20_000 })
      .toBeNull();
  });

  it("honours `maxParallel`, `maxWorkers`, `priority` and `deferUnderLoad`", async () => {
    const low: CheckGroup = {
      name: "low",
      runner: "vitest",
      tests: [C, B],
      at: "edit",
      limits: {
        maxParallel: 1,
        maxWorkers: 3,
        priority: "low",
        deferUnderLoad: { maxLoadPerCpu: 1, maxDeferMs: 300 },
      },
    };
    const { side, slotDir, setLoad } = await groupSide(
      groupPolicy({ checks: [low], slow: { maxDeferMs: 300 } }),
    );
    setLoad(10);
    await allCurrent(side);
    const runs = side.runner.runs.filter((run) => run.lane === "group:low:vitest");
    // `maxParallel` 1: one file a tier; `maxWorkers` 3 a file, from the pool.
    expect(runs.map((run) => run.files.length)).toEqual([1, 1]);
    expect(runs.map((run) => run.workers)).toEqual([3, 3]);
    // Row 019-11's names in the slot directory (no scope given: `"user"`, the directory itself).
    expect(readdirSync(slotDir)).toContain("group.low.0.lock");
    // `deferUnderLoad`: the run waited its `maxDeferMs`, then ran under load with a note.
    const notes = readDaemonNotes(side.store, side.worktreeId).map((note) => note.text);
    expect(notes.some((text) => text.includes('of group "low" ran under load 10.00'))).toBe(true);
  });

  it("takes `maxParallel` files a tier for a `normal` group", async () => {
    const wide: CheckGroup = {
      name: "wide",
      runner: "vitest",
      tests: [C, B],
      at: "edit",
      limits: { maxParallel: 2 },
    };
    const { side } = await groupSide(groupPolicy({ checks: [wide] }));
    await allCurrent(side);
    const runs = side.runner.runs.filter((run) => run.lane === "group:wide:vitest");
    expect(runs.map((run) => run.files.map((f) => f.path).sort())).toEqual([[C, B].sort()]);
  });

  it("holds an `after` group until its predecessor settles at the revision", async () => {
    const unit: CheckGroup = { name: "unit", runner: "vitest", tests: [B], at: "edit" };
    const e2e: CheckGroup = {
      name: "e2e",
      runner: "vitest",
      tests: [C],
      at: "edit",
      after: ["unit"],
    };
    const { side } = await groupSide(groupPolicy({ checks: [e2e, unit] }));
    await allCurrent(side);
    const held = gate(side, (run) => run.lane === "group:unit:vitest");
    const from = side.runner.runs.length;
    await side.edit("watch", "src/core.ts", "src/other.ts");
    await expect
      .poll(() => tierLog(side.runner.runs, from)["group:unit:vitest"], { timeout: 20_000 })
      .toEqual([[B]]);
    await delay(500);
    expect(tierLog(side.runner.runs, from)["group:e2e:vitest"]).toBeUndefined();
    expect(readGroupActivity(side.store, side.worktreeId, "e2e")).toEqual({
      kind: "waiting",
      for: "fast",
    });
    held.open();
    await allCurrent(side);
    const lanes = side.runner.runs.slice(from);
    const unitRun = lanes.find((run) => run.lane === "group:unit:vitest");
    const e2eRun = lanes.find((run) => run.lane === "group:e2e:vitest");
    expect(e2eRun?.startedAt ?? 0).toBeGreaterThanOrEqual(
      unitRun?.endedAt ?? Number.POSITIVE_INFINITY,
    );
  });

  it("reports the next edit's fast files while a long group's tier runs", async () => {
    const e2e: CheckGroup = { name: "e2e", runner: "vitest", tests: [C], at: "edit" };
    const { side } = await groupSide(groupPolicy({ checks: [e2e] }));
    await allCurrent(side);
    const held = gate(side, (run) => run.lane === "group:e2e:vitest");
    await side.edit("watch", "src/core.ts");
    await expect
      .poll(() => readGroupActivity(side.store, side.worktreeId, "e2e")?.kind, { timeout: 20_000 })
      .toBe("running");
    const from = side.runner.runs.length;
    await side.edit("watch", "src/other.ts");
    await expect.poll(() => side.current(B), { timeout: 20_000 }).toBe(true);
    expect(tierLog(side.runner.runs, from).vitest).toEqual([[B]]);
    expect(side.current(C)).toBe(false);
    held.open();
    await allCurrent(side);
    expect(ranPaths(side)).toContain(C);
  });
});
