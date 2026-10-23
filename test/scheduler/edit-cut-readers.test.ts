import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { poolPermitFile } from "../../src/core/capacity/index.js";
import { quietMetaKey } from "../../src/core/scheduler/quiet.js";
import { takePermit } from "../../src/core/slow/index.js";
import type { RunReport, TestFileRef } from "../../src/core/types/index.js";
import {
  type CatchUpFile,
  type CatchUpOptions,
  catchUpRepo,
  catchUpSide,
} from "./catch-up-fixture.js";
import {
  editAndRun,
  FOUR_SHORT,
  importers,
  pastCatchUpQuiet,
  pathsOf,
  transitive,
} from "./edit-cut-fixture.js";

/*
 * Task 011-116 (spec 011 C4 step 4 as amended for 011-116;
 * `research/edit-latency.md` 3 and 6.1, `research/watch-mode-comparison.md`
 * 3 and 5.2): the cut's `runner.tierSize` places go to the revision's other
 * direct importers first, then to the files that import a changed path
 * through other modules or whose runs read it. In toolkit-dev the only check
 * of a `cli.py` edit read it at run time, ran as catch-up and waited 46.4 s
 * for a permit; in squeal two transitive importers under 1 s waited 34 to
 * 43 s in a 41-file backlog tier beside declared-input files.
 */
const A = "src/a.ts";
const E = "src/e.ts";
const HUB = "src/hub.ts";
const READ = "tools/cli.py";
/** Far below the 20 s quiet and any permit holder's remainder. */
const EDIT_BOUND_MS = 5_000;

/** A daemon whose baseline ran `files`, where each of `readers` reads `READ` at run time. */
async function reading(
  files: readonly CatchUpFile[],
  readers: readonly CatchUpFile[],
  options: Partial<CatchUpOptions> = {},
) {
  const repo = catchUpRepo(files, [READ]);
  const side = catchUpSide(repo, repo.main, { files, hostSlots: 4, tierSize: 4, ...options });
  const run = side.runner.run.bind(side.runner);
  const reads = new Set(readers.map((f) => f.path));
  side.runner.run = async (refs, runOptions): Promise<RunReport> => {
    const report = await run(refs, runOptions);
    const observed = report.completedFiles
      .filter((ref) => reads.has(ref.path))
      .map((testFile) => ({ testFile, paths: [READ], directories: [] }));
    return { ...report, observed };
  };
  await side.scheduler.start();
  await side.scheduler.idle();
  return { repo, side };
}

/** Another holder takes each of the pool's `slots` permits once the daemon's tiers gave theirs back. */
async function holdEveryPermit(poolDir: string, slots: number): Promise<void> {
  const held: { close(): void }[] = [];
  onTestFinished(() => {
    for (const db of held) db.close();
  });
  for (let i = 0; i < slots; i++) {
    const path = join(poolDir, poolPermitFile(i));
    const take = () => {
      const db = takePermit(path, { pid: process.pid, worktreeId: "holder" });
      if (db !== null) held.push(db);
      return held.length > i;
    };
    await expect.poll(take, { interval: 10, timeout: 30_000 }).toBe(true);
  }
}

describe("scheduler: an edit's transitive importers and readers share its cut (C4 step 4, task 011-116)", {
  timeout: 120_000,
}, () => {
  it("starts a run-time reader's tier within the edit bound, with every permit held and the lane waiting for quiet", async () => {
    const reader: CatchUpFile = { path: "test/reader.test.ts", ms: 300, realMs: 100, imports: [] };
    const next: CatchUpFile = { path: "src/e.test.ts", ms: 200, realMs: 200, imports: [E] };
    const own: CatchUpFile = { path: "src/a.test.ts", ms: 900, realMs: 200, imports: [A] };
    const far = transitive("t", A, 60, HUB, 200);
    const files = [own, ...importers("d", A, FOUR_SHORT, 200), ...far, next, reader];
    const { repo, side } = await reading(files, [reader]);

    // A catch-up tier the next edit cancels: the lane then waits 20 s for quiet (row 011-94).
    const before = side.runner.runs.length;
    await side.edit("watch", A);
    // The cut's catch-up waits 120 s for quiet first (row 011-153).
    await pastCatchUpQuiet(side);
    const backlog = () => side.runner.runs.slice(before).find((run) => run.workers !== undefined);
    await expect.poll(backlog, { interval: 10, timeout: 30_000 }).toBeDefined();
    await side.edit("watch", E);
    await expect.poll(() => backlog()?.cancelled, { interval: 10, timeout: 30_000 }).toBe(true);
    await expect.poll(() => side.current(next.path), { interval: 10, timeout: 30_000 }).toBe(true);
    await holdEveryPermit(repo.poolDir, 4);

    let quietAtStart: string | null = null;
    side.runner.beforeRun = (refs: readonly TestFileRef[]) => {
      if (refs.some((ref) => ref.path === reader.path))
        quietAtStart = side.store.meta.get(quietMetaKey(side.worktreeId));
    };
    const second = side.runner.runs.length;
    const editAt = performance.now();
    await side.edit("watch", READ);
    await expect
      .poll(() => side.current(reader.path), { interval: 10, timeout: EDIT_BOUND_MS })
      .toBe(true);
    const run = side.runner.runsOf(reader.path).find((r) => side.runner.runs.indexOf(r) >= second);
    if (run === undefined) throw new Error("no run of the reader");
    // An edit's tier: no grant, and it started while the lane still waited for quiet.
    expect(run.workers).toBeUndefined();
    expect(run.startedAt - editAt).toBeLessThan(EDIT_BOUND_MS);
    expect(quietAtStart).not.toBeNull();
    const { lanes } = JSON.parse(quietAtStart ?? "{}") as { lanes: Record<string, number> };
    expect(Math.max(...Object.values(lanes))).toBeGreaterThan(Date.now());
  });

  it("runs two transitive importers under 1 s in edit tiers; declared-input-only files stay catch-up", async () => {
    // The namesake and three direct importers fill the edit's first tier, so no tier mate (task
    // 001-184) takes a sub-second transitive importer into it: only the cut makes it an edit's work.
    const own: CatchUpFile = { path: "src/a.test.ts", ms: 900, imports: [A] };
    const direct = importers("d", A, [100, 200, 300]);
    const fast: CatchUpFile[] = [400, 600].map((ms, i) => ({
      path: `test/fast${i}.test.ts`,
      ms,
      imports: [HUB],
      through: [A],
    }));
    // Squeal's harness files: `src/**` declared as their input, none importing `a.ts`.
    const harness = importers(
      "h",
      "src/harness.ts",
      Array.from({ length: 40 }, () => 2_000),
    );
    const files = [own, ...direct, ...fast, ...harness];
    const policy = { inputs: { "test/h*.test.ts": ["src/**"] } };
    const { side } = await reading(files, [], { hostSlots: 23, policy });
    const result = await editAndRun(side, A);
    expect(result.editPaths).toEqual(pathsOf([own, ...direct, ...fast]));
    expect(result.catchUpPaths).toEqual(pathsOf(harness));
  });
});
