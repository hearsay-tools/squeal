import { describe, expect, it, vi } from "vitest";
import { classLines, fileEntry } from "../../src/cli/named-file-lines.js";
import { daemonLiveness } from "../../src/core/delivery/liveness.js";
import { promotionsMetaKey } from "../../src/core/scheduler/promotions.js";
import { publishedYieldRow, yieldsMetaKey } from "../../src/core/scheduler/yields.js";
import { nextStep } from "../../src/core/status/next-step.js";
import { standingsOf } from "../../src/core/status/standing.js";
import type { RunReport, TestFileRef } from "../../src/core/types/index.js";
import { RUN_MISSING } from "../helpers/baseline.js";
import {
  type CatchUpFile,
  type CatchUpSide,
  catchUpRepo,
  catchUpSide,
} from "./catch-up-fixture.js";
import {
  CUT_WITHIN_MS,
  completions,
  heldRun,
  holdRuns,
  order,
  pause,
  ref,
  SETTLE_MS,
} from "./tier-yields-fixture.js";

/*
 * Row 011-184, the seven tests of `tasks/011-180/notes.md` section 6 (spec
 * 011 C4 step 5 and C15 Rank as amended 2026-10-24): once a tier has run
 * 30 s, a promoted file makes it yield only when it ranks before every file
 * of the tier that has not ended. On cezar's store, 2026-10-24, 11 yields
 * past 30 s cut a file that the wait also selected, and the wait returned
 * later by up to the time that file had run. The scheduler's clock moves
 * ahead (`advance`), so a tier has run 40 s without the test waiting.
 */
const SLOW = [1, 2, 3, 4].map((i) => `test/s${i}.test.ts`);
const isSlow = (path: string) => SLOW.includes(path);
const A = SLOW[0] ?? "";
const P = "f/p.test.ts";
const p = ref(P, "f");
/**
 * The earlier wait's deadline in test 9, on a clock that stands still until
 * the test moves it, so no host's pause ends the wait: the tier is checked
 * again this often until then, and once after.
 */
const EXPIRES_MS = 1_000;
/**
 * The earlier wait's deadline in tests 10 and 11: before the later waits'
 * (60 s and 120 s), so the clock moved past it leaves theirs open, and too
 * far for a check of the tier to come at it before the test moves the clock.
 */
const PROTECTS_MS = 30_000;

/**
 * The scheduler's clock (`SchedulerOptions.now`): it stands still but for
 * `advance` and `cross`. Once crossed, it moves `ms` ahead after `reads` more
 * reads, as the host's clock that passes a deadline in the middle of one
 * decision (review `reviews/0.1.296-r2.md` B2).
 */
function stillClock() {
  let at = Date.now();
  let left = Number.POSITIVE_INFINITY;
  let step = 0;
  return {
    now(): number {
      if (left-- === 0) at += step;
      return at;
    },
    cross(reads: number, ms: number): void {
      left = reads;
      step = ms;
    },
  };
}

/**
 * The kind of each standing the daemon of `side` publishes from now on.
 * `stored` is called once, as the next promotion is stored, inside the
 * request that then decides the tiers.
 */
function published(side: CatchUpSide, stored: () => void = () => {}): string[] {
  const { store, worktreeId } = side;
  const kinds: string[] = [];
  const set = store.meta.set.bind(store.meta);
  let told = false;
  vi.spyOn(store.meta, "set").mockImplementation((key, value) => {
    set(key, value);
    if (key === yieldsMetaKey(worktreeId)) {
      const { tiers } = JSON.parse(value) as { tiers: Record<string, { kind: string }> };
      kinds.push(...Object.values(tiers).map((t) => t.kind));
    } else if (key === promotionsMetaKey(worktreeId) && !told) {
      told = true;
      stored();
    }
  });
  return kinds;
}

/**
 * Reports `path`'s end to the run in flight that holds it, as Vitest's
 * `onTestModuleEnd` does (`RunOptions.fileEnded`), and lists it among the
 * run's completed files with a pass, as Vitest's report does, a cut run's
 * too; the fake runner names none.
 */
function reportsEnds(side: CatchUpSide): (path: string) => void {
  const ends = new Map<string, () => void>();
  const run = side.runner.run.bind(side.runner);
  side.runner.run = async (files, options) => {
    const ended: TestFileRef[] = [];
    for (const f of files)
      ends.set(f.path, () => {
        ended.push(f);
        options.fileEnded?.(f);
      });
    const report = await run(files, options);
    const more = ended.filter((f) => !report.completedFiles.some((c) => c.path === f.path));
    return {
      ...report,
      completedFiles: [...report.completedFiles, ...more],
      results: [...report.results, ...more.map(passOf)],
    };
  };
  return (path) => ends.get(path)?.();
}

/** A pass of `file`'s one test, as the fake runner reports it. */
function passOf(file: TestFileRef): RunReport["results"][number] {
  const check = {
    kind: "test" as const,
    project: file.project,
    testPath: file.path,
    fullName: "runs",
  };
  return { check, outcome: "pass", durationMs: 1, location: null, errors: [] };
}

/**
 * An edit's tier of the four slow files, `ms` each last time, held in
 * flight; P, re-keyed by its project's environment in the same revision,
 * queued behind it, so it is no edit's work that came during the run.
 * `end` names a file of it as ended. `now`: the scheduler's clock, the
 * host's when absent.
 */
async function heldTier(ms: number, now?: () => number) {
  const files: CatchUpFile[] = [
    ...SLOW.map((path) => ({ path, ms, imports: ["src/s.ts"] })),
    { project: "f", path: P, ms: 1, imports: ["src/p.ts"] },
  ];
  const repo = catchUpRepo(files);
  const options = { files, hostSlots: 8, policy: RUN_MISSING };
  const side = catchUpSide(repo, repo.main, now === undefined ? options : { ...options, now });
  await side.scheduler.start();
  await side.scheduler.idle();
  const base = side.runner.runs.length;
  const gate = holdRuns(side.runner, isSlow);
  const end = reportsEnds(side);
  await side.edit("watch", "src/s.ts", "f.config.json");
  const tier = await heldRun(side, A, base);
  return { side, gate, tier, base, waitAt: side.runner.runs.length, end };
}

/** What the live daemon of `side` published for its tiers in flight. */
function standings(side: CatchUpSide) {
  const { store, worktreeId } = side;
  const startedAt = store.worktrees.get(worktreeId)?.daemon?.startedAt ?? 0;
  return [...publishedYieldRow(store, worktreeId, startedAt).tiers.values()];
}

/** The tier is cut; P runs alone first, then the cut files in `rerun`'s order, and all end current. */
async function yieldsToP(
  heldTierOf: Awaited<ReturnType<typeof heldTier>>,
  rerun: readonly string[] = SLOW,
) {
  const { side, gate, tier, waitAt } = heldTierOf;
  await expect.poll(() => tier.cancelled, { timeout: CUT_WITHIN_MS }).toBe(true);
  await expect.poll(() => side.current(P), { timeout: CUT_WITHIN_MS }).toBe(true);
  gate.stop();
  await side.scheduler.idle();
  expect(order(side, waitAt)).toEqual([[P], rerun]);
  expect(tier.completed).toEqual([]);
  expect(SLOW.every((path) => side.current(path))).toBe(true);
}

/** The tier in flight is not cut: it still runs a pause after. */
async function notCut(side: CatchUpSide, tier: Awaited<ReturnType<typeof heldRun>>) {
  await pause(SETTLE_MS);
  expect(tier.cancelled).toBe(false);
  expect(tier.endedAt).toBeNull();
  expect(standings(side)).toEqual([{ kind: "named" }]);
}

describe("a wait's promoted file does not cut a file the same or an earlier wait selected (spec 011 C4 step 5, row 011-184)", {
  timeout: 120_000,
}, () => {
  it("1: at 40 s, a wait on a file of the tier and a queued one: no yield; the tier ends, P runs next", async () => {
    const { side, gate, tier, base, waitAt } = await heldTier(200_000);
    side.advance(40_000);

    await side.scheduler.promote([ref(A), p], 60_000);
    await notCut(side, tier);
    gate.stop();
    await side.scheduler.idle();

    // On main, A was cut and ran twice: `[[P], SLOW]`.
    expect(tier.completed.map((f) => f.path)).toEqual(SLOW);
    expect(order(side, waitAt)).toEqual([[P]]);
    expect(completions(side, A, base)).toBe(1);
    expect([A, P].every((path) => side.current(path))).toBe(true);
  });

  it("2: at 10 s, the same wait makes the tier yield as before", async () => {
    const held = await heldTier(200_000);
    held.side.advance(10_000);

    await held.side.scheduler.promote([ref(A), p], 60_000);
    await yieldsToP(held);
  });

  it("3: P selected by an earlier wait than A's: the tier yields as before", async () => {
    const held = await heldTier(35_000);
    const { side, tier } = held;
    // 25 s remain, not over 30 s: the earlier wait's P makes it yield at its bound only.
    side.advance(10_000);
    await side.scheduler.promote([p], 120_000);
    await pause(SETTLE_MS);
    expect(tier.cancelled).toBe(false);
    expect(standings(side)).toMatchObject([{ kind: "remainder" }]);

    // 35 s past its estimate, a later wait selects A and P: P ranks by the earlier request.
    side.advance(60_000);
    await side.scheduler.promote([ref(A), p], 60_000);
    await yieldsToP(held);
  });

  it("4: at 40 s, a wait that selects no file of the tier makes it yield as before", async () => {
    const held = await heldTier(200_000);
    held.side.advance(40_000);

    await held.side.scheduler.promote([p], 60_000);
    await yieldsToP(held);
  });

  it("5: at 40 s, an edit's work queued after the wait makes the tier yield as before", async () => {
    const held = await heldTier(200_000);
    const { side, tier } = held;
    side.advance(40_000);
    await side.scheduler.promote([ref(A), p], 60_000);
    await notCut(side, tier);

    await side.edit("watch", "src/p.ts");
    await yieldsToP(held);
  });

  it("6: 35 s past its estimate with only P waiting, no yield and no bound; an edit's work then cuts it", async () => {
    const held = await heldTier(20_000);
    const { side, tier } = held;
    side.advance(55_000);
    await side.scheduler.promote([ref(A), p], 60_000);
    // On main: `overrun` past 30 s, so it yielded at the promotion.
    await notCut(side, tier);

    await side.edit("watch", "src/p.ts");
    await yieldsToP(held);
  });

  it("7: the wait's line and --json name the reason the tier does not yield", async () => {
    const { side, tier } = await heldTier(200_000);
    side.advance(40_000);
    await side.scheduler.promote([ref(A), p], 60_000);
    await notCut(side, tier);

    const { store, worktreeId, root } = side;
    const now = Date.now();
    const daemon = daemonLiveness(store.worktrees.get(worktreeId)?.daemon ?? null, now);
    const [file] = standingsOf(store, worktreeId, root, daemon, now)([p]);
    if (file === undefined) throw new Error("no named file");
    expect(file.standing).toMatchObject({
      kind: "queued",
      promoted: true,
      yields: { kind: "named" },
    });
    const reason = "; the tier does not yield: it runs a file this wait or an earlier one selected";
    // The first line is the header, `Pending (1):`.
    const [, line] = classLines([file], "squeal");
    expect(line).toContain(`${reason}: f: f/p.test.ts`);
    const entry = fileEntry(file, "squeal");
    expect(entry.reason?.endsWith(reason)).toBe(true);
    expect(entry.next).toBe(
      "no command runs it sooner (a running tier that does not yield is waited for)",
    );
    const queued = nextStep({
      kind: "queued",
      lane: "vitest",
      behind: 0,
      files: 4,
      promoted: true,
      yields: { kind: "named" },
    });
    expect(queued.reason.endsWith(reason)).toBe(true);
  });

  // Review `reviews/0.1.296.md` B1 and B2: the rule holds at every moment, not only at a promotion.
  it("8: at 40 s, A of an earlier wait ends: the tier yields for P of a later wait", async () => {
    const held = await heldTier(200_000);
    const { side, tier } = held;
    side.advance(40_000);
    await side.scheduler.promote([ref(A)], 60_000);
    await side.scheduler.promote([p], 60_000);
    await notCut(side, tier);

    // On 5ecb377a8: the end changed no standing, so the tier ran on to its end.
    held.end(A);
    // A's result is in the cut run's report: only the files that had not ended run again.
    await yieldsToP(held, SLOW.slice(1));
  });

  it("9: at 40 s, the earlier wait on A passes its deadline while P's is open: the tier yields", async () => {
    const held = await heldTier(200_000, stillClock().now);
    const { side, tier } = held;
    side.advance(40_000);
    // The clock stands still: A's wait stays open until the test moves it past its deadline.
    await side.scheduler.promote([ref(A)], EXPIRES_MS);
    await side.scheduler.promote([p], 60_000);
    await notCut(side, tier);

    // No event comes. On 5ecb377a8: `named` had no bound, so the tier ran on to its end.
    side.advance(EXPIRES_MS);
    await yieldsToP(held);
  });

  // Review `reviews/0.1.296-r2.md` B2: the clock passes the earlier wait's deadline during the decision.
  it("10: A's deadline passes while P's promotion is decided: the tier yields for P with no later event", async () => {
    const clock = stillClock();
    const held = await heldTier(200_000, clock.now);
    const { side } = held;
    side.advance(40_000);
    await side.scheduler.promote([ref(A)], PROTECTS_MS);
    // Once P's promotion is stored, the clock passes A's deadline after two more reads: the
    // decision has ranked A by then and reads its bound after (on 231ecaeb0, `untilOf(A)`).
    const kinds = published(side, () => clock.cross(2, PROTECTS_MS));
    await side.scheduler.promote([p], 60_000);

    // On 231ecaeb0: `named` with no bound, so the tier ran on to its end.
    await yieldsToP(held);
    expect(kinds.slice(0, 2)).toEqual(["named", "yields"]);
  });

  it("11: the same when a later wait selects another file of the tier: the tier yields at A's deadline", async () => {
    const clock = stillClock();
    const held = await heldTier(200_000, clock.now);
    const { side } = held;
    side.advance(40_000);
    await side.scheduler.promote([ref(A)], PROTECTS_MS);
    await side.scheduler.promote([p], 60_000);
    expect(standings(side)).toEqual([{ kind: "named" }]);
    // The later wait's file of the tier ranks after P, so P beats it once A's wait has ended.
    // Once s2's promotion is stored, the clock passes A's deadline after the decision's one
    // reading and before `#arm` reads it for the timer (row 011-194), which then fires at once.
    published(side, () => clock.cross(1, PROTECTS_MS));
    await side.scheduler.promote([ref(SLOW[1] ?? "")], 120_000);

    // On 231ecaeb0: the bound was the later wait's deadline, 90 s on, so the tier ran on. The
    // later wait is open, so its s2 leads the cut files (C15 Rank); before row 011-193 the cut
    // dropped its promotion.
    await yieldsToP(
      held,
      [1, 0, 2, 3].map((i) => SLOW[i] ?? ""),
    );
  });
});
