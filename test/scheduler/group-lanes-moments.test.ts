import { setTimeout as delay } from "node:timers/promises";
import { describe, expect, it } from "vitest";
import { readGroupActivity } from "../../src/core/slow/state.js";
import type { CheckGroup } from "../../src/core/types/check-groups.js";
import {
  allCurrent,
  groupPolicy,
  groupSide,
  inTurn,
  nodeTestGroup,
  ranPaths,
  tierLog,
} from "./group-lanes-fixture.js";

/*
 * Spec 019 Testing, "Scheduler" (row 019-10): in a fixture with Vitest,
 * node:test and pytest files, each moment queues its group at its moment
 * and not before, and explicit requests ignore moments. A configured group
 * runs in its own lane, `group:<name>:<runner lane>`, and publishes its
 * activity under `group-tier:<name>:<worktree>`.
 */

const E2E: CheckGroup = { name: "e2e", runner: "vitest", tests: ["test/e2e/**"], at: "stop" };
const NODES = nodeTestGroup("nodes", "pause", "nt");
const PY: CheckGroup = { name: "py", runner: "pytest", at: "commit" };

const C = "test/e2e/c.test.ts";
const D = "nt/test/d.test.mjs";
const F = "py/tests/test_f.py";

describe("group moments (spec 019 D1, row 019-10)", { timeout: 60_000 }, () => {
  it("runs `pause` and `stop` groups when the agent pauses, a `commit` group only on request", async () => {
    const turn: { end?: () => Promise<void> } = {};
    const { side } = await groupSide(groupPolicy({ checks: [E2E, NODES, PY] }), {
      beforeStart: async (s) => {
        turn.end = (await inTurn(s)).end;
      },
    });
    // In a turn: the `tests` and default `slow` groups run, the others wait for their moment.
    await expect
      .poll(() => ranPaths(side).sort(), { timeout: 20_000 })
      .toEqual(["ns/test/e.test.mjs", "test/a.test.ts", "test/b.test.ts"]);
    await delay(300);
    expect(ranPaths(side)).not.toContain(C);
    expect(readGroupActivity(side.store, side.worktreeId, "e2e")).toEqual({
      kind: "waiting",
      for: "idle",
    });

    await turn.end?.();
    await expect
      .poll(() => ranPaths(side), { timeout: 20_000 })
      .toEqual(expect.arrayContaining([C, D]));
    const log = tierLog(side.runner.runs);
    expect(log["group:e2e:vitest"]).toEqual([[C]]);
    expect(log["group:nodes:node-test"]).toEqual([[D]]);
    // A `commit` group never runs by itself (D5 queues it at a commit).
    await side.scheduler.idle();
    await delay(300);
    expect(ranPaths(side)).not.toContain(F);
    expect(side.scheduler.slowPending()).toBe(false);

    // An explicit request ignores the moment (D1, D6).
    expect(await side.scheduler.requestGroup("py")).toMatchObject({ queued: 1 });
    await allCurrent(side);
    expect(tierLog(side.runner.runs)["group:py:pytest"]).toEqual([[F]]);
    expect(await side.scheduler.requestGroup("nope")).toBeNull();
  });

  it("runs an `edit` group beside the fast files, and holds one with `quietMs` until the revision is that old", async () => {
    const unit: CheckGroup = {
      name: "unit",
      runner: "vitest",
      tests: ["test/a.test.ts"],
      at: "edit",
    };
    const quiet: CheckGroup = {
      name: "quiet",
      runner: "vitest",
      tests: ["test/b.test.ts"],
      at: "edit",
      quietMs: 2_000,
    };
    const { side } = await groupSide(groupPolicy({ checks: [unit, quiet] }));
    await allCurrent(side);
    const from = side.runner.runs.length;
    const edited = performance.now();
    await side.edit("watch", "src/core.ts", "src/other.ts");
    await expect
      .poll(() => tierLog(side.runner.runs, from)["group:unit:vitest"], { timeout: 20_000 })
      .toEqual([["test/a.test.ts"]]);
    await delay(500);
    expect(tierLog(side.runner.runs, from)["group:quiet:vitest"]).toBeUndefined();
    await expect
      .poll(() => tierLog(side.runner.runs, from)["group:quiet:vitest"], { timeout: 20_000 })
      .toEqual([["test/b.test.ts"]]);
    const run = side.runner.runs.find((r, i) => i >= from && r.lane === "group:quiet:vitest");
    expect((run?.startedAt ?? 0) - edited).toBeGreaterThanOrEqual(1_900);
  });

  it("runs a `pause` group in a turn on request, as `run --slow` runs the slow tier", async () => {
    const { side } = await groupSide(groupPolicy({ checks: [NODES] }), {
      beforeStart: async (s) => {
        await inTurn(s);
      },
    });
    await expect.poll(() => ranPaths(side).length, { timeout: 20_000 }).toBeGreaterThan(0);
    await side.scheduler.idle();
    expect(ranPaths(side)).not.toContain(D);
    expect(await side.scheduler.requestGroup("nodes")).toMatchObject({ queued: 1 });
    await expect.poll(() => ranPaths(side), { timeout: 20_000 }).toContain(D);
    // `run --slow` is the default `slow` group's request, unchanged.
    expect(await side.scheduler.requestSlowSuite()).toMatchObject({ queued: 0 });
  });
});
