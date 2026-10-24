import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { poolPermitFile } from "../../src/core/capacity/index.js";
import { takePermit } from "../../src/core/slow/index.js";
import { RUN_MISSING } from "../helpers/baseline.js";
import {
  type CatchUpFile,
  type CatchUpOptions,
  type CatchUpRun,
  catchUpRepo,
  catchUpSide,
  sources,
  testFiles,
} from "./catch-up-fixture.js";

/*
 * Task 011-22 with review W4r of wave 4 (spec 011 C4 step 4: after four tiers
 * of the first group, the next is the second group's, catch-up first): the
 * turn is selected while an edit's work is queued, so it is never
 * cancelled, but its files are the backlog's: it takes the pool's grant, and
 * in a lane of slots it is one slot, beside which the edit's tiers run.
 */
const TWELVE = sources(12);
const edited = (count: number, realMs: number): CatchUpFile[] =>
  Array.from({ length: count }, (_, i) => ({
    path: `test/e${i}.test.ts`,
    ms: 1_000,
    realMs,
    imports: ["src/e.ts"],
  }));
const isEdit = (run: CatchUpRun) => run.files.every((f) => f.path.startsWith("test/e"));
const isCatchUp = (run: CatchUpRun) => run.files.every((f) => f.path.startsWith("test/f"));

/** Catch-up of 12 files of `catchUpMs` queued, then 20 edited files: five edit tiers of 4. */
async function turning(catchUpMs: number, editMs: number, options: Partial<CatchUpOptions>) {
  const files = [
    ...testFiles(
      12,
      TWELVE,
      () => 1_000,
      () => catchUpMs,
    ),
    ...edited(20, editMs),
  ];
  const repo = catchUpRepo(files);
  const side = catchUpSide(repo, repo.main, { files, hostSlots: 8, ...options });
  await side.scheduler.start();
  await side.scheduler.idle();
  const before = side.runner.runs.length;
  side.runner.hold();
  await side.edit("watch", ...TWELVE);
  await expect.poll(() => side.runner.active).toBeGreaterThan(0);
  await side.edit("watch", "src/e.ts");
  return { side, before };
}

describe("scheduler: the second group's turn runs on the backlog's route (C4 step 4, task 011-22)", () => {
  it("in a Vitest lane takes a grant, and an edit during it cancels nothing", {
    timeout: 60_000,
  }, async () => {
    const { side, before } = await turning(0, 0, { backlogTierSize: 4 });
    let turn: CatchUpRun | null = null;
    let edits = 0;
    side.runner.beforeRun = (refs) => {
      if (refs.every((f) => f.path.startsWith("test/e"))) edits += 1;
      // The first catch-up tier after four of the edit's is the turn's: held while an edit lands.
      if (edits === 4 && turn === null && refs.every((f) => f.path.startsWith("test/f"))) {
        side.runner.hold();
        turn = side.runner.runs.at(-1) ?? null;
      }
    };
    side.runner.release();
    await expect.poll(() => turn !== null && side.runner.active === 1).toBe(true);
    await side.edit("watch", "src/e.ts");
    await new Promise((resolve) => setTimeout(resolve, 100));
    side.runner.release();
    await side.scheduler.idle();
    const ran = turn as CatchUpRun | null;
    expect(ran?.workers).toBeDefined();
    expect(ran?.cancelled).toBe(false);
    expect(ran?.files.length).toBeLessThanOrEqual(4);
    const runs = side.runner.runs.slice(before);
    expect(runs.filter(isEdit).every((run) => run.workers === undefined)).toBe(true);
  });

  it("in a lane of slots is one slot with its permit, and the edit's next tier runs beside it", {
    timeout: 60_000,
  }, async () => {
    const { side, before } = await turning(400, 20, {
      lane: () => "node-test",
      besideBacklog: () => true,
      backlogSlot: () => 1,
      cancels: false,
    });
    side.runner.release();
    await side.scheduler.idle();
    const runs = side.runner.runs.slice(before);
    const fourth = runs.filter(isEdit)[3];
    if (fourth === undefined) throw new Error("fewer than four edit tiers");
    const turn = runs.find((run) => isCatchUp(run) && run.startedAt > fourth.startedAt);
    if (turn === undefined) throw new Error("no turn");
    expect(turn.files).toHaveLength(1);
    expect(turn.workers).toBe(1);
    const fifth = runs.filter(isEdit)[4];
    expect(fifth?.startedAt).toBeLessThan(turn.endedAt ?? 0);
    expect(runs.filter(isEdit)).toHaveLength(5);
  });

  it("gives way to the edit's tier while the pool would hold it back", {
    timeout: 60_000,
  }, async () => {
    // Lane x's backlog tier holds the daemon's free worker for 3 s; another daemon holds every permit.
    const lanes: CatchUpFile[] = Array.from({ length: 4 }, (_, i) => ({
      project: "x",
      path: `x/test/x${i}.test.ts`,
      ms: 750,
      realMs: 750,
      imports: [],
    }));
    const files = [...testFiles(12, TWELVE, () => 1_000), ...edited(20, 20), ...lanes];
    const repo = catchUpRepo(files);
    const side = catchUpSide(repo, repo.main, {
      files,
      hostSlots: 4,
      lane: (f) => (f.project === "x" ? "x" : "v"),
      policy: RUN_MISSING,
    });
    await side.scheduler.start();
    await side.scheduler.idle();
    for (let i = 0; i < 3; i++) {
      const db = takePermit(join(repo.poolDir, poolPermitFile(i)), {
        pid: process.pid,
        worktreeId: "racing",
      });
      if (db === null) throw new Error(`permit ${i} taken`);
      onTestFinished(() => db.close());
    }
    const before = side.runner.runs.length;
    await side.edit("watch", "x.config.json");
    await expect.poll(() => side.runner.active).toBe(1);
    await side.edit("watch", ...TWELVE);
    await side.edit("watch", "src/e.ts");
    await side.scheduler.idle();
    const runs = side.runner.runs.slice(before);
    const other = runs.find((run) => run.files.every((f) => f.project === "x"));
    const fifth = runs.filter(isEdit)[4];
    expect(other?.workers).toBe(1);
    expect(fifth?.startedAt).toBeLessThan(other?.endedAt ?? 0);
    // The turn's catch-up came once the free worker was back.
    const turn = runs.find(isCatchUp);
    expect(turn?.startedAt).toBeGreaterThanOrEqual(other?.endedAt ?? Number.POSITIVE_INFINITY);
  });
});
