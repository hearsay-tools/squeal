import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { describe, expect, it, onTestFinished } from "vitest";
import type { CheckGroup } from "../../src/core/types/index.js";
import {
  type CatchUpFile,
  type CatchUpSide,
  catchUpRepo,
  catchUpSide,
} from "./catch-up-fixture.js";
import {
  groupPolicy,
  inTurn,
  nodeTestGroup,
  ranPaths,
  runnerLane,
  tierLog,
} from "./group-lanes-fixture.js";

/*
 * Row 019-49 (spec 019 D6, "Narrow run"): `squeal run <group> <path>...`
 * runs now only the group's test files the paths select, whatever its
 * moment. A test file's path selects itself; a source selects its
 * namesakes, or with none its direct importers, then the `runner.tierSize`
 * shortest of its other direct importers, among the group's files. The
 * group's other files keep waiting, and Stop's request stays whole.
 */

const FILES: readonly CatchUpFile[] = [
  { path: "test/unit/a.test.ts", ms: 10, imports: ["src/core.ts"] },
  { path: "test/browser/core.test.ts", ms: 30, imports: ["src/core.ts"] },
  { path: "test/browser/x.test.ts", ms: 10, imports: ["src/core.ts"] },
  { path: "test/browser/z.test.ts", ms: 50, imports: ["src/core.ts"] },
  { path: "test/browser/y.test.ts", ms: 10, imports: ["src/other.ts"] },
  { project: "nt", path: "nt/test/d.test.mjs", ms: 10, imports: ["src/lone.ts"] },
  { project: "nt", path: "nt/test/g.test.mjs", ms: 20, imports: ["src/lone.ts"] },
  { project: "nt", path: "nt/test/k.test.mjs", ms: 10, imports: ["src/core.ts"] },
];

const UNIT: CheckGroup = { name: "unit", runner: "vitest", tests: ["test/unit/**"], at: "stop" };
const BROWSER: CheckGroup = {
  name: "browser",
  runner: "vitest",
  tests: ["test/browser/**"],
  at: "manual",
  limits: { deferUnderLoad: { maxLoadPerCpu: 1, maxDeferMs: 600_000 } },
};
const NODES = nodeTestGroup("nodes", "stop", "nt");
const LINT: CheckGroup = { name: "lint", lint: true, at: "stop" };

/** A started scheduler over `FILES`, a consumer in a turn, the load per CPU at 5. */
async function narrowSide(): Promise<{ side: CatchUpSide; end(): Promise<void> }> {
  const repo = catchUpRepo(FILES);
  const slotDir = mkdtempSync(join(tmpdir(), "squeal-019-49-slot-"));
  onTestFinished(() => rmSync(slotDir, { recursive: true, force: true }));
  const policy = groupPolicy({ checks: [UNIT, BROWSER, NODES, LINT] });
  const side = catchUpSide(repo, repo.main, {
    files: FILES,
    hostSlots: 8,
    tierSize: 1,
    lane: runnerLane,
    policy,
    scheduler: { slow: { slotDir, recheckMs: 50, cpus: () => 1, load: () => [5] } },
  });
  const turn = await inTurn(side);
  await side.scheduler.start();
  await side.scheduler.idle();
  return { side, end: () => turn.end() };
}

/** Lets every lane run what it may; none of `paths` ran. */
async function noneRan(side: CatchUpSide, ...paths: string[]): Promise<void> {
  await side.scheduler.idle();
  await delay(300);
  expect(ranPaths(side).filter((path) => paths.includes(path))).toEqual([]);
}

const paths = (refs: readonly { path: string }[] | undefined) =>
  (refs ?? []).map((r) => r.path).sort();

describe("a narrow run (spec 019 D6, row 019-49)", { timeout: 60_000 }, () => {
  it("runs a manual Vitest group's namesake and K shortest importers of a source, past the load guard", async () => {
    const { side } = await narrowSide();
    await noneRan(side, ...FILES.map((f) => f.path));
    const request = await side.scheduler.requestGroupPaths?.("browser", ["src/core.ts"]);
    expect(paths(request?.narrow.selected)).toEqual([
      "test/browser/core.test.ts",
      "test/browser/x.test.ts",
    ]);
    expect(request).toMatchObject({
      queued: 2,
      narrow: {
        reached: 1,
        unmatched: [],
        others: [
          { group: "unit", files: 1, paths: ["src/core.ts"] },
          { group: "nodes", files: 1, paths: ["src/core.ts"] },
        ],
      },
    });
    await expect.poll(() => side.current("test/browser/x.test.ts"), { timeout: 20_000 }).toBe(true);
    await expect
      .poll(() => side.current("test/browser/core.test.ts"), { timeout: 20_000 })
      .toBe(true);
    await noneRan(side, "test/browser/z.test.ts", "test/browser/y.test.ts", "test/unit/a.test.ts");
    expect(tierLog(side.runner.runs)["group:browser:vitest"]?.flat().sort()).toEqual([
      "test/browser/core.test.ts",
      "test/browser/x.test.ts",
    ]);
  });

  it("selects a test file by its own path, names a path that selects nothing, and runs no current file again", async () => {
    const { side } = await narrowSide();
    const first = await side.scheduler.requestGroupPaths?.("browser", [
      "test/browser/y.test.ts",
      "src/nothing.ts",
    ]);
    expect(first).toMatchObject({
      queued: 1,
      narrow: { reached: 0, others: [], unmatched: ["src/nothing.ts"] },
    });
    expect(paths(first?.narrow.selected)).toEqual(["test/browser/y.test.ts"]);
    await expect.poll(() => side.current("test/browser/y.test.ts"), { timeout: 20_000 }).toBe(true);
    const runs = side.runner.runs.length;
    const again = await side.scheduler.requestGroupPaths?.("browser", ["test/browser/y.test.ts"]);
    expect(again).toMatchObject({ queued: 0 });
    expect(paths(again?.narrow.selected)).toEqual(["test/browser/y.test.ts"]);
    await noneRan(side, "test/browser/core.test.ts", "test/browser/z.test.ts");
    expect(side.runner.runs.length).toBe(runs);
  });

  it("runs a stop node:test group's direct importers of a source with no namesake; Stop still runs the rest", async () => {
    const { side, end } = await narrowSide();
    const request = await side.scheduler.requestGroupPaths?.("nodes", ["src/lone.ts"]);
    expect(paths(request?.narrow.selected)).toEqual(["nt/test/d.test.mjs", "nt/test/g.test.mjs"]);
    expect(request).toMatchObject({ queued: 2, narrow: { reached: 0, others: [], unmatched: [] } });
    await expect.poll(() => side.current("nt/test/g.test.mjs"), { timeout: 20_000 }).toBe(true);
    expect(side.current("nt/test/d.test.mjs")).toBe(true);
    await noneRan(side, "nt/test/k.test.mjs", "test/unit/a.test.ts");
    expect(tierLog(side.runner.runs)["group:nodes:node-test"]?.flat().sort()).toEqual([
      "nt/test/d.test.mjs",
      "nt/test/g.test.mjs",
    ]);
    // The narrow run left the group's other file to its moment: the pause runs it.
    await end();
    await expect.poll(() => side.current("nt/test/k.test.mjs"), { timeout: 20_000 }).toBe(true);
    await expect.poll(() => side.current("test/unit/a.test.ts"), { timeout: 20_000 }).toBe(true);
    await noneRan(side, "test/browser/z.test.ts");
  });

  it("answers null for an unknown group and rejects a lint group", async () => {
    const { side } = await narrowSide();
    expect(await side.scheduler.requestGroupPaths?.("nope", ["src/core.ts"])).toBeNull();
    await expect(side.scheduler.requestGroupPaths?.("lint", ["src/core.ts"])).rejects.toThrow(
      "group lint is a lint group, which runs whole: squeal run lint",
    );
  });
});
