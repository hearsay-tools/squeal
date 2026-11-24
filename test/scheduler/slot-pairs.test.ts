import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { readGroupActivity } from "../../src/core/slow/state.js";
import type { CheckGroup } from "../../src/core/types/check-groups.js";
import type { WorktreeId } from "../../src/core/types/common.js";
import {
  type CatchUpFile,
  type CatchUpSide,
  catchUpRepo,
  catchUpSide,
} from "./catch-up-fixture.js";
import { groupPolicy, inTurn, runnerLane } from "./group-lanes-fixture.js";

/*
 * Row 023-78 (round 10 Z2): one `status --at --run` call queues the same
 * browser files on the commit side and in the working tree, two worktrees of
 * one repository that share the group's one slot. The slot goes to the two
 * sides in turn (spec 004 D2's handover); the side that takes it next runs
 * the file its partner just ran, so every two turns give one compared file.
 * A side whose partner has nothing queued runs its own order at full pace.
 * Review 0.1.612 S2: no fixed leader; the side that takes the free slot
 * first leads. Row 023-83: a late partner follows the leader's first file
 * it has not run, so pairs come in the leader's order.
 */

const PATHS = ["a", "b", "c"].map((n) => `test/browser/${n}.test.ts`);
const [A, B, C] = PATHS as [string, string, string];
const FILES: readonly CatchUpFile[] = PATHS.map((path) => ({
  path,
  ms: 10,
  imports: ["src/core.ts"],
}));

const BROWSER: CheckGroup = {
  name: "browser",
  runner: "vitest",
  tests: ["test/browser/**"],
  at: "manual",
  limits: { maxParallel: 1, maxWorkers: 1, priority: "low" },
};

interface Pair {
  readonly tree: CatchUpSide;
  readonly commit: CatchUpSide;
  /** Every browser run's start, both sides, in order: `tree:<path>` or `commit:<path>`. */
  readonly log: string[];
}

async function pair(recheckMs: number): Promise<Pair> {
  const repo = catchUpRepo(FILES);
  const slotDir = mkdtempSync(join(tmpdir(), "squeal-023-78-slot-"));
  onTestFinished(() => rmSync(slotDir, { recursive: true, force: true }));
  const options = {
    files: FILES,
    hostSlots: 8,
    tierSize: 1,
    lane: runnerLane,
    policy: groupPolicy({ checks: [BROWSER] }),
    scheduler: { slow: { slotDir, recheckMs, cpus: () => 1, load: () => [0] } },
  };
  const tree = catchUpSide(repo, repo.main, options);
  const commit = catchUpSide(repo, repo.other, options);
  // The commit's sources differ from the working tree's, so no file shares a key.
  commit.touch("src/core.ts");
  const log: string[] = [];
  for (const [name, side] of [
    ["tree", tree],
    ["commit", commit],
  ] as const) {
    side.runner.beforeRun = (files) => {
      for (const file of files)
        if (file.path.startsWith("test/browser/")) log.push(`${name}:${file.path}`);
    };
  }
  const turns = [await inTurn(tree), await inTurn(commit)];
  onTestFinished(async () => {
    for (const turn of turns) await turn.end();
  });
  await tree.scheduler.start();
  await commit.scheduler.start();
  await tree.rest();
  await commit.rest();
  return { tree, commit, log };
}

/** Holds `side`'s run of `path` until the returned release is called. */
function holdFirst(side: CatchUpSide, path: string): () => void {
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  onTestFinished(() => release());
  side.runner.holdOf = (run) => (run.files.some((f) => f.path === path) ? held : undefined);
  return () => release();
}

describe("both sides take the shared slot file by file (row 023-78)", { timeout: 60_000 }, () => {
  it("runs each requested file on both sides before the next, in the request's order", async () => {
    const { tree, commit, log } = await pair(50);
    // The commit side's first run holds the slot until the working tree has queued its files.
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    onTestFinished(() => release());
    let first = true;
    commit.runner.holdOf = () => {
      if (!first) return undefined;
      first = false;
      return held;
    };
    await commit.scheduler.requestGroupPaths?.("browser", PATHS, { at: true });
    await expect.poll(() => log.length, { timeout: 20_000 }).toBe(1);
    // The working tree queues the change's own file first, then the commit's selection:
    // its own order is c, a, b.
    await tree.scheduler.requestGroupPaths?.("browser", [C], { at: true });
    await tree.scheduler.requestGroupPaths?.("browser", PATHS, { at: true });
    await tree.rest();
    expect(log).toEqual([`commit:${A}`]);
    release();
    await expect.poll(() => log.length, { timeout: 20_000 }).toBe(6);
    expect(log).toEqual([
      `commit:${A}`,
      `tree:${A}`,
      `commit:${B}`,
      `tree:${B}`,
      `commit:${C}`,
      `tree:${C}`,
    ]);
  });

  it("lets the working tree lead when it takes the slot first, the commit side following", async () => {
    // Review 0.1.612 S2: no side is the fixed leader; whichever takes the free slot first leads.
    const { tree, commit, log } = await pair(50);
    const release = holdFirst(tree, A);
    await tree.scheduler.requestGroupPaths?.("browser", PATHS, { at: true });
    await expect.poll(() => log.length, { timeout: 20_000 }).toBe(1);
    // The commit side's own order is c, a, b.
    await commit.scheduler.requestGroupPaths?.("browser", [C], { at: true });
    await commit.scheduler.requestGroupPaths?.("browser", PATHS, { at: true });
    await commit.rest();
    expect(log).toEqual([`tree:${A}`]);
    release();
    await expect.poll(() => log.length, { timeout: 20_000 }).toBe(6);
    expect(log).toEqual([
      `tree:${A}`,
      `commit:${A}`,
      `tree:${B}`,
      `commit:${B}`,
      `tree:${C}`,
      `commit:${C}`,
    ]);
  });

  it("has a late partner run the leader's first file first, then the rest in the leader's order", async () => {
    // Row 023-83 (round 11, AA2): the commit side ran a and b before the working tree asked;
    // the working tree then ran its partner's latest file first, so the first file paired last.
    const { tree, commit, log } = await pair(50);
    const release = holdFirst(commit, C);
    await commit.scheduler.requestGroupPaths?.("browser", PATHS, { at: true });
    await expect.poll(() => log.length, { timeout: 20_000 }).toBe(3);
    // The working tree's own order is c, a, b: the change's file first.
    await tree.scheduler.requestGroupPaths?.("browser", [C], { at: true });
    await tree.scheduler.requestGroupPaths?.("browser", PATHS, { at: true });
    await tree.rest();
    expect(log).toEqual([`commit:${A}`, `commit:${B}`, `commit:${C}`]);
    release();
    await expect.poll(() => log.length, { timeout: 20_000 }).toBe(6);
    expect(log).toEqual([
      `commit:${A}`,
      `commit:${B}`,
      `commit:${C}`,
      `tree:${A}`,
      `tree:${B}`,
      `tree:${C}`,
    ]);
  });

  it("pairs the commit side's first file first and alternates the turns after a late start", async () => {
    // Row 023-83: the commit side starts first and runs a; the working tree asks while it runs b.
    const { tree, commit, log } = await pair(50);
    const release = holdFirst(commit, B);
    await commit.scheduler.requestGroupPaths?.("browser", PATHS, { at: true });
    await expect.poll(() => log.length, { timeout: 20_000 }).toBe(2);
    await tree.scheduler.requestGroupPaths?.("browser", PATHS, { at: true });
    await tree.rest();
    expect(log).toEqual([`commit:${A}`, `commit:${B}`]);
    // The working tree records that it waits for the slot, which is taken: not "the slot or the pool".
    expect(readGroupActivity(tree.store, tree.worktreeId as WorktreeId, "browser")).toEqual({
      kind: "waiting",
      for: "slot",
      slot: "held",
    });
    release();
    await expect.poll(() => log.length, { timeout: 20_000 }).toBe(6);
    expect(log).toEqual([
      `commit:${A}`,
      `commit:${B}`,
      `tree:${A}`,
      `commit:${C}`,
      `tree:${B}`,
      `tree:${C}`,
    ]);
  });

  it("runs a side alone at full pace when its partner has nothing queued", async () => {
    // A recheck far longer than the test: any wait for a partner would show.
    const { tree, commit, log } = await pair(30_000);
    // The commit side ran `b` before: its record names `b`, and it queues nothing now.
    await commit.scheduler.requestGroupPaths?.("browser", [B], { at: true });
    await expect.poll(() => commit.current(B), { timeout: 20_000 }).toBe(true);
    const started = Date.now();
    await tree.scheduler.requestGroupPaths?.("browser", PATHS, { at: true });
    await expect.poll(() => PATHS.every((p) => tree.current(p)), { timeout: 20_000 }).toBe(true);
    expect(Date.now() - started).toBeLessThan(10_000);
    // It follows the record (`b` first), then its own order.
    expect(log).toEqual([`commit:${B}`, `tree:${B}`, `tree:${A}`, `tree:${C}`]);
  });

  it("keeps its own order when the partner ran a file this side was not asked for, or is gone", async () => {
    const { tree, commit, log } = await pair(30_000);
    // The commit side ran `b` and its daemon is gone; the working tree's request leaves `b` out.
    await commit.scheduler.requestGroupPaths?.("browser", [B], { at: true });
    await expect.poll(() => commit.current(B), { timeout: 20_000 }).toBe(true);
    await commit.scheduler.close();
    const started = Date.now();
    await tree.scheduler.requestGroupPaths?.("browser", [C, A], { at: true });
    await expect.poll(() => [A, C].every((p) => tree.current(p)), { timeout: 20_000 }).toBe(true);
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(log).toEqual([`commit:${B}`, `tree:${C}`, `tree:${A}`]);
  });
});
