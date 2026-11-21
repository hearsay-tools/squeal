import { setTimeout as delay } from "node:timers/promises";
import { describe, expect, it } from "vitest";
import { Priority, RunQueue } from "../../src/core/scheduler/queue.js";
import { decideTakeBack, type TakeBackView } from "../../src/core/scheduler/take-back.js";
import type { CatchUpFile } from "./catch-up-fixture.js";
import { ranPaths } from "./group-lanes-fixture.js";
import { heldSide } from "./take-back-fixture.js";

/*
 * Spec 023 D4.11 (row 023-34, T1; lessons round 5): `take-back` takes out
 * of the queue the files a narrow run queued itself that have not started.
 * A file stays when it runs, was forced, an edit queued it again (recent),
 * or a promotion other than the request's own holds it. In round 5 about
 * 1,300 files a `status --at --run` queued stayed in the daemon after its
 * budget, and the next narrowed call waited behind them.
 */

const view = (over: Partial<TakeBackView> = {}): TakeBackView => ({
  running: () => false,
  promotedElsewhere: () => false,
  release: () => "free",
  ...over,
});

describe("decideTakeBack (T1): each rule", () => {
  const records = [{ owner: "o1", queued: { ids: ["a", "b", "c"], promotions: [7] } }];

  it("takes every file no one else needs", () => {
    expect(decideTakeBack(records, view())).toEqual({
      take: ["a", "b", "c"],
      result: { takenBack: 3, running: 0, kept: 0 },
    });
  });

  it("leaves a running file, counted running", () => {
    const d = decideTakeBack(records, view({ running: (id) => id === "a" }));
    expect(d).toEqual({ take: ["b", "c"], result: { takenBack: 2, running: 1, kept: 0 } });
  });

  it("keeps a file something else needs, and one another promotion holds", () => {
    const released = view({ release: (id) => (id === "a" ? "kept" : "free") });
    expect(decideTakeBack(records, released).result).toEqual({ takenBack: 2, running: 0, kept: 1 });
    const own: (readonly number[])[] = [];
    const elsewhere = view({
      promotedElsewhere: (id, promotions) => {
        own.push(promotions);
        return id === "c";
      },
    });
    expect(decideTakeBack(records, elsewhere).take).toEqual(["a", "b"]);
    // The request's own promotions are the ones excepted.
    expect(own).toEqual([[7], [7], [7]]);
  });

  it("counts nothing for a file no longer queued, and each file once", () => {
    const twice = [...records, { owner: "o2", queued: { ids: ["a"], promotions: [] } }];
    const d = decideTakeBack(twice, view({ release: (id) => (id === "b" ? "absent" : "free") }));
    expect(d).toEqual({ take: ["a", "c"], result: { takenBack: 2, running: 0, kept: 0 } });
  });
});

describe("RunQueue owners (review wave-20 B1)", () => {
  const ref = (path: string) => ({ project: "", path });
  const queue = () => new RunQueue({ now: () => 1_000, isRunning: () => false });

  it("an entry its request queued is free once it gives it up; one shared, once both do", () => {
    const q = queue();
    q.add(ref("a"), Priority.neverRun);
    q.claim(ref("a"), "o1", true);
    q.claim(ref("a"), "o2", false);
    expect(q.release(ref("a"), "o1")).toBe("kept");
    expect(q.release(ref("a"), "o2")).toBe("free");
    expect(q.release(ref("b"), "o1")).toBe("absent");
  });

  it("an entry queued again for any other cause is nobody's", () => {
    const q = queue();
    q.add(ref("a"), Priority.neverRun);
    q.claim(ref("a"), "o1", true);
    // An edit, catch-up or a demoted reader queues it again.
    q.add(ref("a"), Priority.transitive, false, false, true);
    expect(q.release(ref("a"), "o1")).toBe("kept");
    // One found queued for another cause is not claimed.
    q.add(ref("b"), Priority.neverRun);
    q.claim(ref("b"), "o1", false);
    expect(q.release(ref("b"), "o1")).toBe("kept");
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
    const mine = own === null ? [] : [own];
    expect(queue.promotedElsewhere(ref("a"), mine, clock.now)).toBe(false);
    clock.now += 20_000;
    expect(queue.promotedElsewhere(ref("a"), mine, clock.now)).toBe(false);
    // A named wait that selects `a` holds it while the wait is open.
    expect(queue.promote([ref("a")], clock.now + 60_000)).not.toBeNull();
    expect(queue.promotedElsewhere(ref("a"), mine, clock.now)).toBe(true);
    expect(queue.promotedElsewhere(ref("b"), mine, clock.now)).toBe(false);
    clock.now += 61_000;
    expect(queue.promotedElsewhere(ref("a"), mine, clock.now)).toBe(false);
  });
});

const FILES: readonly CatchUpFile[] = [
  { path: "test/browser/a.test.ts", ms: 10, imports: ["src/core.ts"] },
  { path: "test/browser/b.test.ts", ms: 20, imports: ["src/core.ts"] },
  { path: "test/browser/c.test.ts", ms: 30, imports: ["src/core.ts"] },
];

describe("a narrow run taken back (T1)", { timeout: 60_000 }, () => {
  it("takes out its queued files, leaves the running one, and runs nothing more", async () => {
    const { side, gate } = await heldSide(FILES);
    const paths = FILES.map((f) => f.path);
    const request = await side.scheduler.requestGroupPaths?.("browser", paths, { owner: "o1" });
    expect(request).toMatchObject({ queued: 3 });
    // One file starts (tier size 1) and is held; the other two wait in the queue.
    await expect.poll(() => side.runner.runs.length, { timeout: 20_000 }).toBe(1);
    const started = ranPaths(side);
    const taken = await side.scheduler.takeBack?.(["o1"]);
    expect(taken).toEqual({ takenBack: 2, running: 1, kept: 0 });
    // Taken once: the same owner takes nothing again.
    expect(await side.scheduler.takeBack?.(["o1"])).toEqual({
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

describe("a request not taken yet when its call takes it back (review wave-20 B3)", {
  timeout: 60_000,
}, () => {
  it("queues nothing once the scheduler takes it, and nothing runs", async () => {
    const { side, gate } = await heldSide(FILES);
    gate.stop();
    // A source path asks the runner under the lock: holding that answer holds the intake.
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let asked = false;
    const affected = side.runner.affected;
    side.runner.affected = async (changed) => {
      asked = true;
      await held;
      return affected(changed);
    };
    const request = side.scheduler.requestGroupPaths?.("browser", ["src/core.ts"], { owner: "o1" });
    await expect.poll(() => asked, { timeout: 20_000 }).toBe(true);
    // The call's budget ended: its take-back comes while the request waits.
    const back = side.scheduler.takeBack?.(["o1"]);
    release();
    await expect(request).resolves.toMatchObject({ queued: 0 });
    await expect(back).resolves.toEqual({ takenBack: 0, running: 0, kept: 0 });
    await side.rest();
    await delay(300);
    expect(ranPaths(side)).toEqual([]);
  });
});
