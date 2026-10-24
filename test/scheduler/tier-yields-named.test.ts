import { describe, expect, it } from "vitest";
import { classLines, fileEntry } from "../../src/cli/named-file-lines.js";
import { daemonLiveness } from "../../src/core/delivery/liveness.js";
import { publishedYields } from "../../src/core/scheduler/yields.js";
import { nextStep } from "../../src/core/status/next-step.js";
import { standingsOf } from "../../src/core/status/standing.js";
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
 * The earlier wait's deadline in test 9: longer than its two promotions
 * take under the scheduler's lock on a loaded host, so the later one comes
 * while it is open, and shorter than `CUT_WITHIN_MS`.
 */
const EXPIRES_MS = 5_000;

/**
 * Reports `path`'s end to the run in flight that holds it, as Vitest's
 * `onTestModuleEnd` does (`RunOptions.fileEnded`); the fake runner names none.
 */
function reportsEnds(side: CatchUpSide): (path: string) => void {
  const ends = new Map<string, () => void>();
  const run = side.runner.run.bind(side.runner);
  side.runner.run = (files, options) => {
    for (const f of files) ends.set(f.path, () => options.fileEnded?.(f));
    return run(files, options);
  };
  return (path) => ends.get(path)?.();
}

/**
 * An edit's tier of the four slow files, `ms` each last time, held in
 * flight; P, re-keyed by its project's environment in the same revision,
 * queued behind it, so it is no edit's work that came during the run.
 * `end` names a file of it as ended.
 */
async function heldTier(ms: number) {
  const files: CatchUpFile[] = [
    ...SLOW.map((path) => ({ path, ms, imports: ["src/s.ts"] })),
    { project: "f", path: P, ms: 1, imports: ["src/p.ts"] },
  ];
  const repo = catchUpRepo(files);
  const side = catchUpSide(repo, repo.main, { files, hostSlots: 8, policy: RUN_MISSING });
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
  return [...publishedYields(store, worktreeId, startedAt).values()];
}

/** The tier is cut; P runs alone first, then the cut files, and all end current. */
async function yieldsToP(heldTierOf: Awaited<ReturnType<typeof heldTier>>) {
  const { side, gate, tier, waitAt } = heldTierOf;
  await expect.poll(() => tier.cancelled, { timeout: CUT_WITHIN_MS }).toBe(true);
  await expect.poll(() => side.current(P), { timeout: CUT_WITHIN_MS }).toBe(true);
  gate.stop();
  await side.scheduler.idle();
  expect(order(side, waitAt)).toEqual([[P], SLOW]);
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
    await yieldsToP(held);
  });

  it("9: at 40 s, the earlier wait on A passes its deadline while P's is open: the tier yields", async () => {
    const held = await heldTier(200_000);
    const { side } = held;
    side.advance(40_000);
    // A's wait ends `EXPIRES_MS` from now on the host's clock; no event comes then.
    await side.scheduler.promote([ref(A)], EXPIRES_MS);
    await side.scheduler.promote([p], 60_000);
    expect(standings(side)).toEqual([{ kind: "named" }]);

    // On 5ecb377a8: `named` had no bound, so the tier ran on to its end.
    await yieldsToP(held);
  });
});
