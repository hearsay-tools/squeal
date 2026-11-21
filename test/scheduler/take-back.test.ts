import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { describe, expect, it, onTestFinished } from "vitest";
import { Priority, RunQueue } from "../../src/core/scheduler/queue.js";
import { decideTakeBack, type TakeBackView } from "../../src/core/scheduler/take-back.js";
import type { CheckGroup } from "../../src/core/types/check-groups.js";
import { Gate } from "./batch-fixture.js";
import { type CatchUpFile, catchUpRepo, catchUpSide } from "./catch-up-fixture.js";
import { groupPolicy, inTurn, ranPaths, runnerLane } from "./group-lanes-fixture.js";

/*
 * Spec 023 D4.11 (row 023-34, T1; lessons round 5): `take-back` takes out
 * of the queue the files a narrow run queued itself that have not started.
 * A file stays when it runs, was forced, an edit queued it again (recent),
 * or a promotion other than the request's own holds it. In round 5 about
 * 1,300 files a `status --at --run` queued stayed in the daemon after its
 * budget, and the next narrowed call waited behind them.
 */

const none = () => false;
const view = (over: Partial<TakeBackView> = {}): TakeBackView => ({
  queued: () => true,
  running: none,
  forced: none,
  recent: none,
  promotedElsewhere: none,
  ...over,
});

describe("decideTakeBack (T1): each skip rule", () => {
  const records = [{ ids: ["a", "b", "c"], promotion: 7 }];

  it("takes every queued file a narrow run queued itself", () => {
    expect(decideTakeBack(records, view())).toEqual({
      take: ["a", "b", "c"],
      result: { takenBack: 3, running: 0, kept: 0 },
    });
  });

  it("leaves a running file, counted running", () => {
    const d = decideTakeBack(records, view({ running: (id) => id === "a" }));
    expect(d).toEqual({ take: ["b", "c"], result: { takenBack: 2, running: 1, kept: 0 } });
  });

  it("keeps a forced file, a recent one and one another promotion holds", () => {
    expect(decideTakeBack(records, view({ forced: (id) => id === "a" })).take).toEqual(["b", "c"]);
    expect(decideTakeBack(records, view({ recent: (id) => id === "b" })).take).toEqual(["a", "c"]);
    const asked: (number | null)[] = [];
    const elsewhere = view({
      promotedElsewhere: (id, own) => {
        asked.push(own);
        return id === "c";
      },
    });
    expect(decideTakeBack(records, elsewhere)).toEqual({
      take: ["a", "b"],
      result: { takenBack: 2, running: 0, kept: 1 },
    });
    // The request's own promotion is the one excepted.
    expect(new Set(asked)).toEqual(new Set([7]));
  });

  it("counts nothing for a file no longer queued, and each file once", () => {
    const twice = [...records, { ids: ["a"], promotion: 8 }];
    const d = decideTakeBack(twice, view({ queued: (id) => id !== "b" }));
    expect(d).toEqual({ take: ["a", "c"], result: { takenBack: 2, running: 0, kept: 0 } });
  });
});

describe("RunQueue.promotedElsewhere (T1)", () => {
  const ref = (path: string) => ({ project: "", path });

  it("is a live promotion other than the request's own", () => {
    const clock = { now: 1_000 };
    const queue = new RunQueue({ now: () => clock.now, isRunning: () => false });
    queue.add(ref("a"), Priority.neverRun);
    queue.add(ref("b"), Priority.neverRun);
    const own = queue.promote([ref("a"), ref("b")], clock.now + 10_000);
    expect(own).not.toBeNull();
    expect(queue.promotedElsewhere(ref("a"), own, clock.now)).toBe(false);
    clock.now += 20_000;
    // The narrow run's own batch holds `a` past its deadline; still not elsewhere.
    expect(queue.promotedElsewhere(ref("a"), own, clock.now)).toBe(false);
    // A named wait that selects `a` holds it while the wait is open.
    const wait = queue.promote([ref("a")], clock.now + 60_000);
    expect(wait).not.toBeNull();
    expect(queue.promotedElsewhere(ref("a"), own, clock.now)).toBe(true);
    expect(queue.promotedElsewhere(ref("b"), own, clock.now)).toBe(false);
    clock.now += 61_000;
    expect(queue.promotedElsewhere(ref("a"), own, clock.now)).toBe(false);
    // A wait whose batch holds `c`, past its deadline too.
    queue.add(ref("c"), Priority.neverRun);
    const other = queue.promote([ref("c")], clock.now + 1_000);
    clock.now += 2_000;
    expect(queue.promotedElsewhere(ref("c"), own, clock.now)).toBe(true);
    expect(queue.promotedElsewhere(ref("c"), other, clock.now)).toBe(false);
  });
});

const FILES: readonly CatchUpFile[] = [
  { path: "test/browser/a.test.ts", ms: 10, imports: ["src/core.ts"] },
  { path: "test/browser/b.test.ts", ms: 20, imports: ["src/core.ts"] },
  { path: "test/browser/c.test.ts", ms: 30, imports: ["src/core.ts"] },
];
const BROWSER: CheckGroup = {
  name: "browser",
  runner: "vitest",
  tests: ["test/browser/**"],
  at: "manual",
};

describe("a narrow run taken back (T1)", { timeout: 60_000 }, () => {
  it("takes out its queued files, leaves the running one, and runs nothing more", async () => {
    const repo = catchUpRepo(FILES);
    const slotDir = mkdtempSync(join(tmpdir(), "squeal-023-34-slot-"));
    onTestFinished(() => rmSync(slotDir, { recursive: true, force: true }));
    const side = catchUpSide(repo, repo.main, {
      files: FILES,
      hostSlots: 8,
      tierSize: 1,
      lane: runnerLane,
      // The default baseline, as a user's daemon has it: a miss is not queued until asked.
      policy: { ...groupPolicy({ checks: [BROWSER] }), baseline: { onStart: "lookup-only" } },
      scheduler: { slow: { slotDir, recheckMs: 50, cpus: () => 1, load: () => [0] } },
    });
    const turn = await inTurn(side);
    onTestFinished(() => turn.end());
    await side.scheduler.start();
    await side.rest();
    const gate = new Gate();
    side.runner.holdOf = () => gate.wait();
    const paths = FILES.map((f) => f.path);
    const request = await side.scheduler.requestGroupPaths?.("browser", paths);
    expect(request).toMatchObject({ queued: 3 });
    const coveredId = request?.coveredId ?? "";
    // One file starts (tier size 1) and is held; the other two wait in the queue.
    await expect.poll(() => side.runner.runs.length, { timeout: 20_000 }).toBe(1);
    const started = ranPaths(side);
    const taken = await side.scheduler.takeBack?.([coveredId]);
    expect(taken).toEqual({ takenBack: 2, running: 1, kept: 0 });
    // Taken once: the same id takes nothing again.
    expect(await side.scheduler.takeBack?.([coveredId])).toEqual({
      takenBack: 0,
      running: 0,
      kept: 0,
    });
    gate.stop();
    await expect.poll(() => side.current(started[0] ?? ""), { timeout: 20_000 }).toBe(true);
    await side.rest();
    await delay(300);
    expect(ranPaths(side)).toEqual(started);
    for (const path of paths.filter((p) => !started.includes(p)))
      expect(side.current(path)).toBe(false);
  });
});
