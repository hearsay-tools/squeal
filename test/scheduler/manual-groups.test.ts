import { setTimeout as delay } from "node:timers/promises";
import { describe, expect, it } from "vitest";
import { readCommitReports } from "../../src/core/commit/index.js";
import { readGroupActivity } from "../../src/core/slow/state.js";
import type { CheckGroup } from "../../src/core/types/index.js";
import { git } from "../hash/git-repo.js";
import type { CatchUpSide } from "./catch-up-fixture.js";
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
 * Row 019-47 (spec 019 D1 as amended 2026-11-05): a Vitest and a node:test
 * group at `manual` start none of their files at an edit, a pause or a
 * commit; `squeal run <group>` and `run --all` run them. A queued file of
 * one holds no drain and is no commit's work: the report counts it as
 * unknown and waits for nothing.
 */

const PARITY: CheckGroup = {
  name: "parity",
  runner: "vitest",
  tests: ["test/e2e/**"],
  at: "manual",
};
const NODES = nodeTestGroup("nodes", "manual", "nt");
const C = "test/e2e/c.test.ts";
const D = "nt/test/d.test.mjs";

/** The idle reconciliation pass (spec 001 D2), which looks at `HEAD`. */
async function pass(side: CatchUpSide): Promise<void> {
  await side.scheduler.handleBatch({ trigger: "interval", paths: [] });
  await side.scheduler.idle();
}

/** Lets every lane run what it may; none of `paths` ran. */
async function noneRan(side: CatchUpSide, ...paths: string[]): Promise<void> {
  await side.scheduler.idle();
  await delay(300);
  expect(ranPaths(side).filter((path) => paths.includes(path))).toEqual([]);
}

describe("a group at `manual` (spec 019 D1, row 019-47)", { timeout: 60_000 }, () => {
  it("starts no file at an edit, a pause or a commit; `squeal run <group>` runs it", async () => {
    const turn: { end?: () => Promise<void> } = {};
    const { side } = await groupSide(groupPolicy({ checks: [PARITY, NODES] }), {
      beforeStart: async (s) => {
        turn.end = (await inTurn(s)).end;
      },
    });
    await expect.poll(() => ranPaths(side), { timeout: 20_000 }).toContain("test/a.test.ts");
    await noneRan(side, C, D);

    await turn.end?.();
    await noneRan(side, C, D);

    const from = side.runner.runs.length;
    await side.edit("watch", "src/core.ts");
    await expect
      .poll(() => tierLog(side.runner.runs, from).vitest, { timeout: 20_000 })
      .toEqual([["test/a.test.ts"]]);
    await noneRan(side, C, D);

    git(side.root, ["commit", "-qam", "core"]);
    await pass(side);
    await noneRan(side, C, D);
    const report = readCommitReports(side.store.meta, side.worktreeId)?.reports[0];
    expect(report, "a queued `manual` file runs for no commit").toMatchObject({
      tests: { running: 0, unknown: 2 },
    });
    expect(report).not.toHaveProperty("waiting");
    expect(side.scheduler.slowPending(), "a drain does not wait for them").toBe(false);
    expect(readGroupActivity(side.store, side.worktreeId, "parity")).toBeNull();

    expect(await side.scheduler.requestGroup("parity")).toMatchObject({ queued: 1 });
    await expect.poll(() => side.current(C), { timeout: 20_000 }).toBe(true);
    await noneRan(side, D);
    expect(await side.scheduler.requestGroup("nodes")).toMatchObject({ queued: 1 });
    await allCurrent(side);
    const log = tierLog(side.runner.runs);
    expect(log["group:parity:vitest"]).toEqual([[C]]);
    expect(log["group:nodes:node-test"]).toEqual([[D]]);
  });

  it("runs on `run --all`", async () => {
    const { side } = await groupSide(groupPolicy({ checks: [PARITY, NODES] }));
    await expect.poll(() => ranPaths(side), { timeout: 20_000 }).toContain("test/a.test.ts");
    await noneRan(side, C, D);
    await side.scheduler.requestFullSuite();
    await allCurrent(side);
    expect(ranPaths(side)).toEqual(expect.arrayContaining([C, D]));
  });
});
