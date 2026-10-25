import { describe, expect, it } from "vitest";
import { testFileId } from "../../src/core/keys/index.js";
import { promotionsMetaKey } from "../../src/core/scheduler/promotions.js";
import type { RunReport, TestFileRef } from "../../src/core/types/index.js";
import { RUN_MISSING } from "../helpers/baseline.js";
import {
  type CatchUpFile,
  type CatchUpSide,
  catchUpRepo,
  catchUpSide,
} from "./catch-up-fixture.js";
import { CUT_WITHIN_MS, heldRun, holdRuns, ref } from "./tier-yields-fixture.js";

/*
 * Row 011-193 (spec 011 C15 Lifetime): a promotion lasts until its deadline
 * or until none of its files is queued or running, also while a record
 * queues its files again. 016-18's model-based probe found the loss in 36
 * of 300 sequences (`016-extensions/research/model-scheduler.md` finding 3,
 * F): the record cleared the file's running mark before it queued the file
 * again, and the `add` between settled its promotion. The scheduler's clock
 * stands still but for `advance`, so no deadline passes while the host is
 * slow.
 */
const SLOW = [1, 2, 3, 4].map((i) => `test/s${i}.test.ts`);
const S4 = SLOW[3] ?? "";
const P = "f/p.test.ts";

/** A scheduler of `files`, started and idle, whose runs of a file `held` matches are held. */
async function sideOf(files: readonly CatchUpFile[], held: readonly string[]) {
  const repo = catchUpRepo(files);
  const start = Date.now();
  const options = { files, hostSlots: 8, policy: RUN_MISSING, now: () => start };
  const side = catchUpSide(repo, repo.main, options);
  await side.scheduler.start();
  await side.scheduler.idle();
  const base = side.runner.runs.length;
  const gate = holdRuns(side.runner, (path) => held.includes(path));
  return { side, gate, base };
}

/** The test files of each live promotion the daemon of `side` published, by `testFileId`. */
function promotions(side: CatchUpSide): string[][] {
  const raw = side.store.meta.get(promotionsMetaKey(side.worktreeId));
  if (raw === null) return [];
  const { promotions } = JSON.parse(raw) as { promotions: { files: string[] }[] };
  return promotions.map((p) => p.files);
}

/** The runner of `side` reports its next run as `change` makes the report. */
function nextReport(
  side: CatchUpSide,
  change: (report: RunReport, files: readonly TestFileRef[]) => RunReport,
): void {
  const run = side.runner.run.bind(side.runner);
  let next = true;
  side.runner.run = async (files, options) => {
    const report = await run(files, options);
    if (!next) return report;
    next = false;
    return change(report, files);
  };
}

/** No file of the run completed. */
const none = (report: RunReport): RunReport => ({ ...report, completedFiles: [], results: [] });

/** S in the default project and G in project g, both 1 ms last time, in one held tier of an edit. */
const S = "test/s.test.ts";
const G = "g/g.test.ts";
const PAIR: CatchUpFile[] = [
  { path: S, ms: 1, imports: ["src/s.ts"] },
  { project: "g", path: G, ms: 1, imports: ["src/s.ts"] },
];

/** A wait promotes S while its tier runs; the run ends as `change` says, and S runs again. */
async function promotedThrough(
  change: (report: RunReport, files: readonly TestFileRef[]) => RunReport,
) {
  const { side, base } = await sideOf(PAIR, [S, G]);
  nextReport(side, change);
  await side.edit("watch", "src/s.ts");
  const tier = await heldRun(side, S, base);
  expect(tier.files.map((f) => f.path).sort()).toEqual([G, S]);
  const waitAt = side.runner.runs.length;
  await side.scheduler.promote([ref(S)], 120_000);
  side.runner.release();
  await heldRun(side, S, waitAt);
  return side;
}

describe("a record keeps the promotions of the files it queues again (spec 011 C15 Lifetime, row 011-193)", {
  timeout: 120_000,
}, () => {
  it("016-18's F: the tier yields to a later wait's P; the earlier wait on s4 still promotes s4", async () => {
    const files: CatchUpFile[] = [
      ...SLOW.map((path) => ({ path, ms: 200_000, imports: ["src/s.ts"] })),
      { project: "f", path: P, ms: 1, imports: ["src/p.ts"] },
    ];
    const { side, gate, base } = await sideOf(files, SLOW);
    // P, re-keyed by its project's environment in the same revision, waits behind the tier.
    await side.edit("watch", "src/s.ts", "f.config.json");
    const tier = await heldRun(side, S4, base);
    const waitAt = side.runner.runs.length;
    side.advance(1_000);
    await side.scheduler.promote([ref(S4)], 120_000);
    // The tier has run 1 s and has 199 s left: it yields to P.
    await side.scheduler.promote([ref(P, "f")], 60_000);
    await expect.poll(() => tier.cancelled, { timeout: CUT_WITHIN_MS }).toBe(true);

    // s4 runs again; on main its promotion went when the cut queued it again.
    await heldRun(side, S4, waitAt);
    expect(promotions(side)).toContainEqual([testFileId(ref(S4))]);
    gate.stop();
    await side.scheduler.idle();
    expect(SLOW.every((path) => side.current(path))).toBe(true);
  });

  it("a timed-out tier's files split into tiers of one: the wait still promotes S", async () => {
    const side = await promotedThrough((report) => ({ ...none(report), end: "timed-out" }));
    // On main: gone when the split queued S again.
    expect(promotions(side)).toEqual([[testFileId(ref(S))]]);
  });

  it("a startup failure of project g keeps S from starting: the wait still promotes S", async () => {
    const side = await promotedThrough((report, files) => ({
      ...none(report),
      failure: "Error: g's setup failed",
      startupFailure: {
        projects: ["g"],
        testFiles: files,
        setupFile: "g/setup.ts",
        error: {
          name: "Error",
          message: "g's setup failed",
          stack: null,
          location: null,
          diff: null,
        },
      },
    }));
    // On main: gone when `failStartup` queued S again.
    expect(promotions(side)).toEqual([[testFileId(ref(S))]]);
  });
});
