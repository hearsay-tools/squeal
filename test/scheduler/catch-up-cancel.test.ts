import { describe, expect, it } from "vitest";
import {
  type CatchUpFile,
  type CatchUpRun,
  catchUpRepo,
  catchUpSide,
  sources,
  testFiles,
} from "./catch-up-fixture.js";

/*
 * Task 011-22 (spec 011 C4 step 4 as amended 2026-10-20, `research/catch-up.md`
 * done-when 4): catch-up runs on the backlog's route, so a later edit
 * cancels its Vitest tier and runs first, or runs beside its node:test or
 * pytest slots. As edit tiers, cezar's agent waited up to 577 s for one.
 */
const TWELVE = sources(12);
const at = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** `count` files importing `src/e.ts`, an agent's module, of 200 ms. */
const edited = (count: number, realMs = 200): CatchUpFile[] =>
  Array.from({ length: count }, (_, i) => ({
    path: `test/e${i}.test.ts`,
    ms: realMs,
    realMs,
    imports: ["src/e.ts"],
  }));

/** The runs after `before` whose files hold one of `paths`. */
function holding(runs: readonly CatchUpRun[], paths: readonly string[]): CatchUpRun[] {
  return runs.filter((run) => run.files.some((f) => paths.includes(f.path)));
}

describe("scheduler: a later edit cancels catch-up or runs beside it (C4 step 4, task 011-22)", () => {
  it("4. cancels a catch-up Vitest tier 1 s in, runs the edit within its own run plus 6 s, and keeps what finished", {
    timeout: 60_000,
  }, async () => {
    const catchUp = testFiles(
      60,
      TWELVE,
      () => 200,
      () => 200,
    );
    const agent = edited(4);
    // A second project's environment change: backlog work, queued while catch-up runs.
    const backlog: CatchUpFile[] = Array.from({ length: 8 }, (_, i) => ({
      project: "b",
      path: `b/test/b${i}.test.ts`,
      ms: 200,
      realMs: 200,
      imports: [],
    }));
    const files = [...catchUp, ...agent, ...backlog];
    const repo = catchUpRepo(files);
    const side = catchUpSide(repo, repo.main, { files, hostSlots: 4 });
    await side.scheduler.start();
    await side.scheduler.idle();
    const before = side.runner.runs.length;

    await side.edit("watch", ...TWELVE);
    await expect.poll(() => side.runner.runs.length).toBeGreaterThan(before);
    const tier = side.runner.runs[before];
    if (tier === undefined) throw new Error("no catch-up tier");
    await side.edit("watch", "b.config.json");
    await at(tier.startedAt + 1_000 - performance.now());
    const editAt = performance.now();
    await side.edit("watch", "src/e.ts");
    await expect
      .poll(() => agent.every((f) => side.current(f.path)), { interval: 10, timeout: 30_000 })
      .toBe(true);
    const currentAt = performance.now();
    await side.scheduler.idle();

    const runs = side.runner.runs.slice(before);
    expect(tier.workers).toBeDefined();
    expect(tier.files).toHaveLength(60);
    expect(tier.cancelled).toBe(true);
    const kept = tier.completed.map((f) => f.path);
    expect(kept.length).toBeGreaterThan(0);
    expect(kept.length).toBeLessThan(60);
    // The edit's tier is next: its own files, no grant.
    const [edit, ...rest] = runs.slice(1);
    expect(edit?.files.map((f) => f.path)).toEqual(agent.map((f) => f.path));
    expect(edit?.workers).toBeUndefined();
    const own = (edit?.endedAt ?? 0) - (edit?.startedAt ?? 0);
    expect(currentAt - editAt).toBeLessThanOrEqual(own + 6_000);
    // What finished keeps its result; the rest is catch-up still, ahead of the backlog.
    for (const path of kept) expect(holding(runs, [path])).toHaveLength(1);
    const after = rest.flatMap((run) => run.files.map((f) => f.path));
    const unfinished = catchUp.map((f) => f.path).filter((path) => !kept.includes(path));
    expect(after.slice(0, unfinished.length).sort()).toEqual(unfinished.sort());
    expect(after.slice(unfinished.length).sort()).toEqual(backlog.map((f) => f.path).sort());
    expect(holding(rest, unfinished).every((run) => run.workers !== undefined)).toBe(true);
    expect(files.every((f) => side.current(f.path))).toBe(true);
  });

  it("4. starts the edit's node:test tier beside the catch-up slots, with no permit", {
    timeout: 60_000,
  }, async () => {
    const catchUp = testFiles(
      24,
      TWELVE,
      () => 500,
      () => 500,
    );
    const agent = edited(1, 100);
    const files = [...catchUp, ...agent];
    const repo = catchUpRepo(files);
    const side = catchUpSide(repo, repo.main, {
      files,
      hostSlots: 4,
      lane: () => "node-test",
      besideBacklog: () => true,
      backlogSlot: () => 1,
      cancels: false,
    });
    await side.scheduler.start();
    await side.scheduler.idle();
    const before = side.runner.runs.length;

    // The catch-up slots hold until the edit's run starts, so they are in flight beside it
    // however slow the host: on a loaded CI runner all 24 files ended before the edit's
    // tier started (main CI 39413164976).
    side.runner.hold();
    side.runner.beforeRun = (started) => {
      if (started.some((f) => f.path === "test/e0.test.ts")) side.runner.release();
    };
    await side.edit("watch", ...TWELVE);
    await expect.poll(() => side.runner.active, { timeout: 30_000 }).toBe(4);
    const first = side.runner.runs[before];
    if (first === undefined) throw new Error("no catch-up slot");
    await at(first.startedAt + 1_000 - performance.now());
    await side.edit("watch", "src/e.ts");
    await side.scheduler.idle();

    const runs = side.runner.runs.slice(before);
    const [edit] = holding(runs, ["test/e0.test.ts"]);
    if (edit === undefined) throw new Error("no edit's run");
    expect(edit.files.map((f) => f.path)).toEqual(["test/e0.test.ts"]);
    expect(edit.workers).toBeUndefined();
    const slots = holding(
      runs,
      catchUp.map((f) => f.path),
    );
    // One file per slot, each with its permit; none cancelled.
    expect(slots.every((run) => run.files.length === 1 && run.workers === 1)).toBe(true);
    expect(slots.some((run) => run.cancelled)).toBe(false);
    const beside = slots.filter(
      (run) => run.startedAt < edit.startedAt && (run.endedAt ?? 0) > edit.startedAt,
    );
    expect(beside.length).toBeGreaterThan(0);
    // The edit ended while catch-up slots still ran, and each catch-up file ran once.
    expect(slots.some((run) => (run.endedAt ?? 0) > (edit.endedAt ?? 0))).toBe(true);
    expect(slots).toHaveLength(24);
  });
});
