import { describe, expect, it } from "vitest";
import { BACKLOG_QUIET_MS } from "../../src/core/scheduler/quiet.js";
import { type CatchUpFile, type CatchUpOptions, catchUpSide } from "./catch-up-fixture.js";
import {
  editAndRun,
  expectCut,
  FOUR_SHORT,
  idleAfterQuiet,
  importers,
  pastCatchUpQuiet,
  pathsOf,
  split,
  started,
  transitive,
} from "./edit-cut-fixture.js";
import { SETTLE_MS } from "./tier-yields-fixture.js";

/*
 * Task 011-25 (spec 011 C4 step 4 as amended 2026-10-20; `research/edit-cut.md`
 * done-when 5, 6, 8, 9): what the cut sends to catch-up takes catch-up's
 * route, so the agent's own test file still reports first, the next edit
 * cancels it or runs beside it, a named wait promotes a file of it, and a
 * daemon start classifies its unrefined revisions alike.
 */
const A = "src/a.ts";
const E = "src/e.ts";
const at = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const own = (realMs = 0): CatchUpFile => ({ path: "src/a.test.ts", ms: 900, realMs, imports: [A] });
const others = (realMs = 0) => importers("d", A, FOUR_SHORT, realMs);

describe("scheduler: the cut's catch-up takes catch-up's route (C4 step 4, task 011-25)", {
  timeout: 120_000,
}, () => {
  it("5. has the own namesake and an edited test file current before any catch-up tier starts", async () => {
    const edited: CatchUpFile = { path: "test/x.test.ts", ms: 3_000, imports: [] };
    const far = transitive("t", A, 60);
    const { side } = await started([own(), edited, ...others(), ...far]);
    const before = side.runner.runs.length;
    const states = new Map<number, boolean>();
    side.runner.beforeRun = () => {
      const both = side.current(own().path) && side.current(edited.path);
      states.set(side.runner.runs.length - 1, both);
    };
    await side.edit("watch", A, edited.path);
    await idleAfterQuiet(side);
    const { catchUp } = split(side.runner.runs, before);
    expect(catchUp.length).toBeGreaterThan(0);
    for (const run of catchUp) expect(states.get(side.runner.runs.indexOf(run))).toBe(true);
  });

  it("6. cancels the cut's catch-up Vitest tier 1 s in: the next edit's namesake is current within its run plus 6 s", {
    timeout: 60_000,
  }, async () => {
    const next: CatchUpFile = { path: "src/e.test.ts", ms: 200, realMs: 200, imports: [E] };
    const far = transitive("t", A, 60, "src/hub.ts", 200);
    let offset = 0;
    const { side } = await started([own(200), ...others(200), ...far, next], {
      hostSlots: 4,
      now: () => Date.now() + offset,
    });
    const before = side.runner.runs.length;
    await side.edit("watch", A);
    // The cut's catch-up waits 120 s for quiet first (row 011-153).
    await pastCatchUpQuiet(side);
    await expect
      .poll(() => side.runner.runs.slice(before).find((run) => run.workers !== undefined), {
        interval: 10,
        timeout: 30_000,
      })
      .toBeDefined();
    const tier = side.runner.runs.slice(before).find((run) => run.workers !== undefined);
    if (tier === undefined) throw new Error("no catch-up tier");
    await at(tier.startedAt + 1_000 - performance.now());
    const editAt = performance.now();
    const second = side.runner.runs.length;
    await side.edit("watch", E);
    await expect.poll(() => side.current(next.path), { interval: 10, timeout: 30_000 }).toBe(true);
    const currentAt = performance.now();
    // The cancel starts the lane's 20 s wait for quiet (row 011-94): no catch-up tier starts in
    // it from the second edit on, and the clock then moves past it rather than the test idling
    // 20 s (CI run 39696846845; review 0.1.253 B2: counted from the edit, not from the cancel).
    await expect.poll(() => tier.cancelled, { interval: 10, timeout: 30_000 }).toBe(true);
    await at(SETTLE_MS);
    expect(side.runner.runs.slice(second).filter((run) => run.workers !== undefined)).toEqual([]);
    offset += BACKLOG_QUIET_MS;
    await side.scheduler.idle();
    const edit = side.runner.runs
      .slice(second)
      .find((run) => run.files.some((f) => f.path === next.path));
    if (edit === undefined) throw new Error("no edit's run");
    expect(edit.workers).toBeUndefined();
    expect(currentAt - editAt).toBeLessThanOrEqual((edit.endedAt ?? 0) - edit.startedAt + 6_000);
  });

  it("6. starts the next edit's node:test tier beside the cut's catch-up slots, with no permit", {
    timeout: 60_000,
  }, async () => {
    const next: CatchUpFile = { path: "src/e.test.ts", ms: 100, realMs: 100, imports: [E] };
    const far = transitive("t", A, 24, "src/hub.ts", 500);
    const { side } = await started([own(), ...others(), ...far, next], {
      hostSlots: 4,
      lane: () => "node-test",
      besideBacklog: () => true,
      backlogSlot: () => 1,
      cancels: false,
    });
    const before = side.runner.runs.length;
    await side.edit("watch", A);
    await expect.poll(() => side.runner.active, { interval: 10, timeout: 30_000 }).toBe(4);
    // A slot that starts from here runs until the edit's tier has started. A fixed 1 s put the
    // edit on the boundary of two 500 ms rounds, where no slot may be running (CI run 39695184172).
    side.runner.hold();
    const held = side.runner.runs.length;
    await expect
      .poll(() => side.runner.runs.length, { interval: 10, timeout: 30_000 })
      .toBeGreaterThan(held);
    const second = side.runner.runs.length;
    await side.edit("watch", E);
    const ran = () =>
      side.runner.runs.slice(second).some((run) => run.files.some((f) => f.path === next.path));
    await expect.poll(ran, { interval: 10, timeout: 30_000 }).toBe(true);
    side.runner.release();
    await side.scheduler.idle();
    const edit = side.runner.runs
      .slice(second)
      .find((run) => run.files.some((f) => f.path === next.path));
    if (edit === undefined) throw new Error("no edit's run");
    expect(edit.files.map((f) => f.path)).toEqual([next.path]);
    expect(edit.workers).toBeUndefined();
    const slots = side.runner.runs.slice(before).filter((run) => run.workers !== undefined);
    const beside = slots.filter(
      (run) => run.startedAt < edit.startedAt && (run.endedAt ?? 0) > edit.startedAt,
    );
    expect(beside.length).toBeGreaterThan(0);
  });

  it("8. makes a declared-input test and a direct importer beyond the 4 catch-up; a named wait promotes them", async () => {
    // As slow as the importers beyond the 4, so it is no kept file's tier mate (task 001-184).
    const guard: CatchUpFile = { path: "test/guard.test.ts", ms: 5_000, imports: [] };
    const far = transitive("t", A, 60);
    const files = [own(), ...others(), guard, ...far];
    const policy = { inputs: { [guard.path]: ["fixtures/**"] } };
    const plain = await started(files, { policy }, ["fixtures/data.json"]);
    const cut = await editAndRun(plain.side, A, "fixtures/data.json");
    expectCut(cut, [own(), ...others().slice(0, 4)], [...others().slice(4), guard]);

    const named = await started(files, { policy }, ["fixtures/data.json"]);
    const { side } = named;
    const before = side.runner.runs.length;
    side.runner.hold();
    await side.edit("watch", A, "fixtures/data.json");
    await expect.poll(() => side.runner.runs.length, { timeout: 30_000 }).toBeGreaterThan(before);
    const promoted = [guard, ...others().slice(4)];
    await side.scheduler.promote(
      promoted.map((f) => ({ project: "", path: f.path })),
      60_000,
    );
    side.runner.release();
    await idleAfterQuiet(side);
    const result = split(side.runner.runs, before);
    expect(result.editPaths).toEqual(expect.arrayContaining(pathsOf(promoted)));
    expect(result.catchUpPaths).not.toContain(guard.path);
  });

  it.each<[string, CatchUpOptions["policy"]]>([
    ["lookup-then-run-missing", undefined],
    ["lookup-only", { baseline: { onStart: "lookup-only" } }],
  ])(
    "9. classifies a daemon start's unrefined small revision by namesakes and affected (%s)",
    async (name, policy) => {
      const files = [own(), ...others(), ...transitive("t", A, 60)];
      const { repo, side } = await started(files);
      await side.scheduler.close();
      side.touch(A);
      const opts = { files, hostSlots: 23, tierSize: 4, ...(policy ? { policy } : {}) };
      const restarted = catchUpSide(repo, repo.main, opts);
      await restarted.scheduler.start();
      await restarted.scheduler.idle();
      const result = split(restarted.runner.runs, 0);
      if (name === "lookup-only") {
        expect(result.after).toEqual([]);
        return;
      }
      expectCut(result, [own(), ...others().slice(0, 4)], others().slice(4));
      expect(result.edits.length).toBeLessThanOrEqual(2);
    },
  );
});
