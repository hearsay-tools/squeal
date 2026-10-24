import { describe, expect, it } from "vitest";
import { RUN_MISSING } from "../helpers/baseline.js";
import {
  type CatchUpFile,
  type CatchUpOptions,
  type CatchUpRun,
  type CatchUpSide,
  catchUpRepo,
  catchUpSide,
  sources,
  testFiles,
} from "./catch-up-fixture.js";

/*
 * Task 011-22 (spec 011 C4 step 4 as amended 2026-10-20, `research/catch-up.md`
 * done-when 5 to 7): catch-up runs after an edit's work and ahead of the
 * rest of the second group, failing first, then shortest first, with no
 * edited, direct or transitive split; the four-tiers turn takes it first;
 * an edit or a named wait still moves one of its files to the first group.
 */
const TWELVE = sources(12);

/** `count` files of `ms` importing `source`, as `test/<name>N.test.ts`. */
const importing = (name: string, count: number, source: string, ms = 1_000): CatchUpFile[] =>
  Array.from({ length: count }, (_, i) => ({
    path: `test/${name}${i}.test.ts`,
    ms,
    imports: [source],
  }));

/** Runs after `before` that did something: a run cancelled before any file ended is left out. */
function effective(side: CatchUpSide, before: number): CatchUpRun[] {
  return side.runner.runs
    .slice(before)
    .filter((run) => !(run.cancelled && run.completed.length === 0));
}

/**
 * Under `lookup-only` nothing has run; a `run --all` queues every file as the backlog, held in its
 * first tier, then the catch-up revision of `TWELVE` and the edit of `src/e.ts` land.
 */
async function queuedAll(files: readonly CatchUpFile[], options: Partial<CatchUpOptions> = {}) {
  const repo = catchUpRepo(files);
  const side = catchUpSide(repo, repo.main, {
    files,
    hostSlots: 4,
    backlogTierSize: 4,
    policy: { baseline: { onStart: "lookup-only" } },
    ...options,
  });
  await side.scheduler.start();
  await side.scheduler.idle();
  side.runner.hold();
  await side.scheduler.requestFullSuite();
  await expect.poll(() => side.runner.active).toBe(1);
  await side.edit("watch", ...TWELVE);
  await side.edit("watch", "src/e.ts");
  side.runner.release();
  await side.scheduler.idle();
  return side;
}

describe("scheduler: catch-up's place in the order (C4 step 4, task 011-22)", {
  timeout: 120_000,
}, () => {
  it("5. runs the edit, then catch-up, then the run --all backlog", async () => {
    const edit = importing("e", 2, "src/e.ts");
    const catchUp = testFiles(12, TWELVE, () => 1_000);
    const backlog = importing("b", 8, "src/b.ts");
    const side = await queuedAll([...edit, ...catchUp, ...backlog]);
    const group = (path: string) =>
      edit.some((f) => f.path === path) ? 0 : catchUp.some((f) => f.path === path) ? 1 : 2;
    const order = effective(side, 0).flatMap((run) => run.files.map((f) => group(f.path)));
    expect(order).toHaveLength(22);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("5. takes a catch-up tier on the turn after four tiers of the edit's", async () => {
    const edit = importing("e", 20, "src/e.ts");
    const catchUp = testFiles(12, TWELVE, () => 1_000);
    const backlog = importing("b", 8, "src/b.ts");
    const side = await queuedAll([...edit, ...catchUp, ...backlog]);
    const kind = (run: CatchUpRun) => {
      const paths = run.files.map((f) => f.path);
      if (paths.every((p) => p.startsWith("test/e"))) return "edit";
      if (paths.every((p) => p.startsWith("test/f"))) return "catch-up";
      return paths.every((p) => p.startsWith("test/b")) ? "backlog" : "mixed";
    };
    const runs = effective(side, 0);
    expect(runs.slice(0, 6).map(kind)).toEqual([
      "edit",
      "edit",
      "edit",
      "edit",
      "catch-up",
      "edit",
    ]);
    // The turn's tier takes the backlog's grant; the edit's tiers take none (review W4r).
    expect(runs.slice(0, 6).map((run) => run.workers !== undefined)).toEqual([
      false,
      false,
      false,
      false,
      true,
      false,
    ]);
  });

  describe("6. a queued catch-up file moves to the first group", () => {
    /** A catch-up tier of 4 of 24 files held in flight, and the longest file still queued. */
    async function catchingUp() {
      const files = testFiles(24, TWELVE, (i) => 1_000 + i * 10);
      const repo = catchUpRepo(files);
      const side = catchUpSide(repo, repo.main, { files, hostSlots: 4, backlogTierSize: 4 });
      await side.scheduler.start();
      await side.scheduler.idle();
      side.runner.hold();
      const before = side.runner.runs.length;
      await side.edit("watch", ...TWELVE);
      await expect.poll(() => side.runner.active).toBe(1);
      const last = files.at(-1)?.path ?? "";
      expect(side.runner.runs[before]?.files.map((f) => f.path)).not.toContain(last);
      return { side, before, last };
    }

    it("when a later edit re-keys it", async () => {
      const { side, before, last } = await catchingUp();
      await side.edit("watch", last);
      side.runner.release();
      await side.scheduler.idle();
      const [tier, next] = side.runner.runs.slice(before);
      expect(tier?.cancelled).toBe(true);
      expect(next?.files[0]?.path).toBe(last);
      expect(next?.workers).toBeUndefined();
    });

    it("when a named wait promotes it", async () => {
      const { side, before, last } = await catchingUp();
      await side.scheduler.promote([{ project: "", path: last }], 60_000);
      side.runner.release();
      await side.scheduler.idle();
      const [tier, next] = side.runner.runs.slice(before);
      // A promotion cancels nothing: the catch-up tier ends, and the promoted file leads the next.
      expect(tier?.cancelled).toBe(false);
      expect(next?.files[0]?.path).toBe(last);
      expect(next?.workers).toBeUndefined();
    });
  });

  describe("7. shortest first: 50 files of 0.1 s are current before an edited 60 s file ends", () => {
    // The edited 60 s file and 11 sources the light files import: 12 keyed paths.
    const ELEVEN = sources(11);
    const light = testFiles(
      50,
      ELEVEN,
      () => 100,
      () => 2,
    );
    const heavy: CatchUpFile = { path: "test/heavy.test.ts", ms: 60_000, realMs: 600, imports: [] };
    const files = [...light, heavy];

    async function changed(options: Partial<CatchUpOptions>) {
      const repo = catchUpRepo(files);
      const side = catchUpSide(repo, repo.main, {
        files,
        hostSlots: 4,
        policy: RUN_MISSING,
        ...options,
      });
      await side.scheduler.start();
      await side.scheduler.idle();
      const before = side.runner.runs.length;
      return { side, before };
    }

    it("in a Vitest lane, where the heavy file exceeds the tier's budget (timeoutMs 100 s: 50 s)", async () => {
      const { side, before } = await changed({ timeoutMs: 100_000 });
      let lightAtHeavy: boolean | null = null;
      side.runner.beforeRun = (refs) => {
        if (refs.some((f) => f.path === heavy.path)) {
          lightAtHeavy = light.every((f) => side.current(f.path));
        }
      };
      await side.edit("watch", heavy.path, ...ELEVEN);
      await side.scheduler.idle();
      expect(lightAtHeavy).toBe(true);
      const [first] = side.runner.runs.slice(before);
      expect(first?.files).toHaveLength(50);
    });

    it("in a node:test lane, in slots", async () => {
      const { side, before } = await changed({
        lane: () => "node-test",
        besideBacklog: () => true,
        backlogSlot: () => 1,
        cancels: false,
      });
      const heavyRuns = () =>
        side.runner.runs.slice(before).filter((r) => r.files.some((f) => f.path === heavy.path));
      await side.edit("watch", heavy.path, ...ELEVEN);
      await expect
        .poll(() => light.every((f) => side.current(f.path)), { interval: 5, timeout: 30_000 })
        .toBe(true);
      expect(heavyRuns().every((run) => run.endedAt === null)).toBe(true);
      await side.scheduler.idle();
      expect(heavyRuns()).toHaveLength(1);
    });
  });
});
