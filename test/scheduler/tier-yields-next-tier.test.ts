import { describe, expect, it } from "vitest";
import { publishedYieldRow } from "../../src/core/scheduler/yields.js";
import { RUN_MISSING } from "../helpers/baseline.js";
import {
  type CatchUpFile,
  type CatchUpSide,
  catchUpRepo,
  catchUpSide,
} from "./catch-up-fixture.js";
import { ModelClock } from "./model-clock.js";
import {
  CUT_WITHIN_MS,
  heldRun,
  holdRuns,
  order,
  pause,
  ref,
  SETTLE_MS,
} from "./tier-yields-fixture.js";

/*
 * Row 011-263 (gh-121, `research/issue-121.md` F3; spec 011 C4 step 5 and
 * C15 Rank as amended 2026-10-28): a promoted file makes a tier yield only
 * when the cut starts it before the tier's estimated remainder. The cut
 * files that rank before it go back to the queue ahead of it and form tiers
 * as an edit's tier forms (`runner.tierSize` and the tier-sharing rule); it
 * starts sooner when it joins the first of those tiers, or when the tiers
 * before its own, each taking its longest last-known duration, end before
 * the remainder (`yield-sooner.test.ts` covers that later tier). This file
 * covers the first case: the cut files an earlier open wait selected fill
 * the next tier, or the promoted file shares it with them as the
 * tier-sharing rule allows. The scheduler's clock is a `ModelClock`, not
 * installed: it stands still but for the side's `advance`, so no host's
 * pause passes a deadline, and the timers stay the host's.
 */
const SLOW = [1, 2, 3, 4].map((i) => `test/s${i}.test.ts`);
const Q = "f/q.test.ts";
const q = ref(Q, "f");
const slow = (count: number) => SLOW.slice(0, count);
const refs = (paths: readonly string[]) => paths.map((path) => ref(path));

/**
 * An edit's tier of `running`, `ms` each last time, held in flight; Q,
 * `qMs` last time, re-keyed by its project's environment in the same
 * revision, queued behind it, so it is no edit's work that came during the
 * run. The tier's files import the edited path directly, so they go first.
 */
async function heldTier(running: readonly string[], ms: number, qMs: number) {
  const files: CatchUpFile[] = [
    ...running.map((path) => ({ path, ms, imports: ["src/s.ts"] })),
    { project: "f", path: Q, ms: qMs, imports: ["src/q.ts"] },
  ];
  const repo = catchUpRepo(files);
  const now = new ModelClock().now;
  const side = catchUpSide(repo, repo.main, { files, hostSlots: 8, policy: RUN_MISSING, now });
  await side.scheduler.start();
  await side.scheduler.idle();
  const base = side.runner.runs.length;
  const gate = holdRuns(side.runner, (path) => running.includes(path));
  await side.edit("watch", "src/s.ts", "f.config.json");
  const tier = await heldRun(side, running[0] ?? "", base);
  expect(tier.files.map((f) => f.path)).toEqual(running);
  return { side, gate, tier, waitAt: side.runner.runs.length };
}

/** What the live daemon of `side` published for its tiers in flight. */
function standings(side: CatchUpSide) {
  const { store, worktreeId } = side;
  const startedAt = store.worktrees.get(worktreeId)?.daemon?.startedAt ?? 0;
  return [...publishedYieldRow(store, worktreeId, startedAt).tiers.values()];
}

/** The tier in flight is not cut: it still runs a pause after, and stands `named`. */
async function notCut(held: Awaited<ReturnType<typeof heldTier>>) {
  await pause(SETTLE_MS);
  expect(held.tier.cancelled).toBe(false);
  expect(held.tier.endedAt).toBeNull();
  expect(standings(held.side)).toEqual([{ kind: "named" }]);
}

/** The held tier runs to its end, Q runs after it in a tier of its own, and all end current. */
async function endsThenQ(held: Awaited<ReturnType<typeof heldTier>>, running: readonly string[]) {
  const { side, gate, tier, waitAt } = held;
  gate.stop();
  await side.scheduler.idle();
  expect(tier.completed.map((f) => f.path)).toEqual(running);
  expect(order(side, waitAt)).toEqual([[Q]]);
  expect([...running, Q].every((path) => side.current(path))).toBe(true);
}

describe("a yield to a promoted file runs that file sooner (spec 011 C4 step 5, row 011-263)", {
  timeout: 120_000,
}, () => {
  it("F3: wait A names the three running files; at 10 s wait B adds Q: no yield, Q runs after the tier", async () => {
    const running = slow(3);
    const held = await heldTier(running, 308_000, 1);
    await held.side.scheduler.promote(refs(running), 60_000);
    held.side.advance(10_000);

    await held.side.scheduler.promote([...refs(running), q], 60_000);
    // On main: cut at 10 s; the three ran again first, by A's rank, then Q.
    await notCut(held);
    await endsThenQ(held, running);
  });

  it("the cut files an earlier wait selected fill the next tier: no yield", async () => {
    const held = await heldTier(SLOW, 200_000, 100_000);
    // Q's 100 s shares a tier with the 200 s files, but A's four take the whole tier of 4.
    await held.side.scheduler.promote(refs(SLOW), 60_000);
    held.side.advance(10_000);

    await held.side.scheduler.promote([q], 60_000);
    // On main: cut at 10 s; the four ran again first, then Q.
    await notCut(held);
    await endsThenQ(held, SLOW);
  });

  it("Q shares the next tier with the cut file an earlier wait selected: the tier yields as before", async () => {
    const held = await heldTier(SLOW, 200_000, 100_000);
    const { side, gate, tier, waitAt } = held;
    await side.scheduler.promote(refs(slow(1)), 60_000);
    side.advance(10_000);

    await side.scheduler.promote([q], 60_000);
    await expect.poll(() => tier.cancelled, { timeout: CUT_WITHIN_MS }).toBe(true);
    // s1 by A's rank, Q by B's, then the cut files that share their tier.
    await heldRun(side, Q, waitAt);
    expect(order(side, waitAt)[0]).toEqual([SLOW[0], Q, SLOW[1], SLOW[2]]);
    gate.stop();
    await side.scheduler.idle();
    expect([...SLOW, Q].every((path) => side.current(path))).toBe(true);
  });

  it("A's wait ends before 30 s: with no event, Q goes first and the tier yields", async () => {
    const running = slow(3);
    const held = await heldTier(running, 308_000, 1);
    const { side, gate, tier, waitAt } = held;
    // A's deadline is 1 s after B's request: the tier is checked again this often until then.
    await side.scheduler.promote(refs(running), 11_000);
    side.advance(10_000);
    await side.scheduler.promote([...refs(running), q], 60_000);
    await notCut(held);

    // B ranks the three as it ranks Q, and C4's order puts Q's 1 ms first.
    side.advance(1_000);
    await expect.poll(() => tier.cancelled, { timeout: CUT_WITHIN_MS }).toBe(true);
    await expect.poll(() => side.current(Q), { timeout: CUT_WITHIN_MS }).toBe(true);
    gate.stop();
    await side.scheduler.idle();
    expect(order(side, waitAt)).toEqual([[Q], running]);
  });
});
