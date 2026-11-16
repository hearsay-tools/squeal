import { describe, expect, it } from "vitest";
import { CLAIM_RECHECK_MS, claimBoundMs } from "../../src/core/scheduler/claims.js";
import { RUN_MISSING } from "../helpers/baseline.js";
import type { CatchUpOptions, CatchUpSide } from "./catch-up-fixture.js";
import {
  F,
  filesOf,
  isSlow,
  named,
  ranSince,
  rowOf,
  SLOW,
  sides,
} from "./tier-yields-claim-fixture.js";
import { heldRun, holdRuns, ref, settle } from "./tier-yields-fixture.js";

/*
 * Row 011-123, review `reviews/0.1.271.md` B1 (spec 011 C7 and C15): once
 * another worktree's claim of a promoted file's key ends with no result, the
 * tier in its lane yields as C15 says, with no new edit or promotion; a
 * claimant that stores a result needs no yield. Before the repair nothing
 * checked the tier again: the file waited for it. Row 011-363: both clocks
 * are virtual; a recheck comes when the test moves this worktree's clock,
 * and the test reads at the quiet point (`settle`).
 */

/** Three rechecks while the claim is live. */
const LIVE_RECHECKS = 3;
/** The fixture's heartbeat interval: a claimant two intervals silent has lost its claim (C7). */
const HEARTBEAT_MS = 60_000;

/** `side`'s next claim recheck, `CLAIM_RECHECK_MS` on, then the quiet point of both worktrees. */
async function recheck(side: CatchUpSide, other: CatchUpSide): Promise<void> {
  side.advance(CLAIM_RECHECK_MS);
  await settle(side, other);
}

/**
 * The other worktree runs F's key, held, after a re-key by its project's
 * environment; here F waits at that key behind an edit's tier of four
 * 200 s files, held, and a wait promotes it. The tier runs on through
 * three rechecks, and the wait names the claim.
 */
async function claimedBehindTier(options: Pick<CatchUpOptions, "timeoutMs" | "policy"> = {}) {
  const { main, other } = await sides(filesOf(200_000, 1), options);
  const theirs = holdRuns(other.runner, (path) => path === F);
  await other.edit("watch", "f.config.json");
  await heldRun(other, F, 0);
  const ours = holdRuns(main.runner, isSlow);
  const base = main.runner.runs.length;
  await main.edit("watch", "src/s.ts", "f.config.json");
  const tier = await heldRun(main, SLOW[0] ?? "", base);
  expect(rowOf(main, F)).toMatchObject({ pending: "queued", key: rowOf(other, F)?.key });

  await main.scheduler.promote([ref(F, "f")], 60_000);
  await settle(main, other);
  for (let i = 0; i < LIVE_RECHECKS; i++) await recheck(main, other);
  expect(tier.cancelled).toBe(false);
  expect(named(main, ref(F, "f")).standing).toMatchObject({ kind: "claim", worktree: other.root });
  const done = async () => {
    ours.stop();
    theirs.stop();
    await settle(main, other);
  };
  return { main, other, tier, base, theirs, done };
}

describe("a claim that ends with no result lets the promotion cut its tier (spec 011 C15, row 011-123)", {
  timeout: 120_000,
}, () => {
  it("the claimant's heartbeat lost: the tier yields and F runs here", async () => {
    const { main, other, tier, base, done } = await claimedBehindTier({ policy: RUN_MISSING });

    // The claimant's daemon dies with F held: no result, and no edit or promotion here.
    other.stopBeat();
    other.store.worktrees.heartbeat(other.worktreeId, Date.now() - 3 * HEARTBEAT_MS);
    // The next recheck sees the claim lost.
    await recheck(main, other);
    expect(tier.cancelled).toBe(true);
    expect(ranSince(main, F, base)).toBe(1);

    await done();
    expect(main.current(F)).toBe(true);
    expect(SLOW.every((path) => main.current(path))).toBe(true);
  });

  it("the waiter's bound passed, from its first sight of the claim: the tier yields", async () => {
    const timeoutMs = 40_000;
    // The waiter's bound, 46 s; a claimant beats every 12 s, so its heartbeat stays live throughout.
    expect(claimBoundMs(timeoutMs)).toBe(46_000);
    const { main, other, tier, base, done } = await claimedBehindTier({ timeoutMs });

    // A second request 20 s on: the bound still runs from the first sight, the first promotion's.
    main.clock?.jump(20_000 - LIVE_RECHECKS * CLAIM_RECHECK_MS);
    await main.scheduler.promote([ref(F, "f")], 60_000);
    await settle(main, other);
    expect(tier.cancelled).toBe(false);
    // 50 s since the first sight, past the bound; 30 s since the second request, short of it.
    main.clock?.jump(30_000);
    await recheck(main, other);
    expect(tier.cancelled).toBe(true);
    expect(ranSince(main, F, base)).toBe(1);

    await done();
    expect(main.current(F)).toBe(true);
  });

  it("the claimant's result: this worktree takes it with no run, and the tier runs on", async () => {
    const { main, other, tier, base, theirs, done } = await claimedBehindTier();

    // The claimant's run ends and stores F's result at the claimed key.
    theirs.stop();
    await settle(main, other);
    await recheck(main, other);
    expect(main.current(F)).toBe(true);
    expect(tier.cancelled).toBe(false);
    expect(tier.endedAt).toBeNull();
    expect(ranSince(main, F, base)).toBe(0);

    await done();
    expect(ranSince(main, F, base)).toBe(0);
    expect(tier.completed).toHaveLength(4);
  });

  it("a result stored before the wait's first check: taken with no run, and the tier runs on", async () => {
    const { main, other } = await sides(filesOf(200_000, 1));
    const theirs = holdRuns(other.runner, (path) => path === F);
    await other.edit("watch", "f.config.json");
    await heldRun(other, F, 0);
    const ours = holdRuns(main.runner, isSlow);
    const base = main.runner.runs.length;
    await main.edit("watch", "src/s.ts", "f.config.json");
    const tier = await heldRun(main, SLOW[0] ?? "", base);
    // The claimant records before this worktree looks: F is queued here at a key with a result.
    theirs.stop();
    await settle(main, other);
    expect(other.current(F)).toBe(true);
    expect(rowOf(main, F)).toMatchObject({ pending: "queued", key: rowOf(other, F)?.key });

    await main.scheduler.promote([ref(F, "f")], 60_000);
    await recheck(main, other);
    expect(main.current(F)).toBe(true);
    expect(tier.cancelled).toBe(false);
    expect(ranSince(main, F, base)).toBe(0);

    ours.stop();
    await settle(main, other);
    expect(ranSince(main, F, base)).toBe(0);
  });
});
