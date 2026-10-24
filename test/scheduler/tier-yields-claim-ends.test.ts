import { describe, expect, it } from "vitest";
import { CLAIM_RECHECK_MS, claimBoundMs } from "../../src/core/scheduler/claims.js";
import { RUN_MISSING } from "../helpers/baseline.js";
import type { CatchUpOptions } from "./catch-up-fixture.js";
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
import { heldRun, holdRuns, pause, ref, SETTLE_MS } from "./tier-yields-fixture.js";

/*
 * Row 011-123, review `reviews/0.1.271.md` B1 (spec 011 C7 and C15): once
 * another worktree's claim of a promoted file's key ends with no result, the
 * tier in its lane yields as C15 says, with no new edit or promotion; a
 * claimant that stores a result needs no yield. Before the repair nothing
 * checked the tier again: the file waited for it.
 */

/** A recheck comes every `CLAIM_RECHECK_MS`; ten of them, well short of the wait's 60 s. */
const RECHECK_WITHIN_MS = 10 * CLAIM_RECHECK_MS;
/** Three rechecks while the claim is live. */
const LIVE_MS = 3 * CLAIM_RECHECK_MS;
/** The fixture's heartbeat interval: a claimant two intervals silent has lost its claim (C7). */
const HEARTBEAT_MS = 60_000;

/**
 * The other worktree runs F's key, held, after a re-key by its project's
 * environment; here F waits at that key behind an edit's tier of four
 * 200 s files, held, and a wait promotes it. The tier runs on through
 * three rechecks, and the wait names the claim.
 */
async function claimedBehindTier(
  options: Pick<CatchUpOptions, "timeoutMs" | "now" | "policy"> = {},
) {
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
  await pause(LIVE_MS);
  expect(tier.cancelled).toBe(false);
  expect(named(main, ref(F, "f")).standing).toMatchObject({ kind: "claim", worktree: other.root });
  const done = async () => {
    ours.stop();
    theirs.stop();
    await Promise.all([main.scheduler.idle(), other.scheduler.idle()]);
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
    await expect.poll(() => tier.cancelled, { timeout: RECHECK_WITHIN_MS }).toBe(true);
    await expect.poll(() => ranSince(main, F, base), { timeout: RECHECK_WITHIN_MS }).toBe(1);

    await done();
    expect(main.current(F)).toBe(true);
    expect(SLOW.every((path) => main.current(path))).toBe(true);
  });

  it("the waiter's bound passed, from its first sight of the claim: the tier yields", async () => {
    let skew = 0;
    const timeoutMs = 40_000;
    // The waiter's bound, 46 s; a claimant beats every 12 s, so its heartbeat stays live throughout.
    expect(claimBoundMs(timeoutMs)).toBe(46_000);
    const now = () => Date.now() + skew;
    const { main, tier, base, done } = await claimedBehindTier({ timeoutMs, now });

    // A second request 20 s on: the bound still runs from the first sight, the first promotion's.
    skew += 20_000;
    await main.scheduler.promote([ref(F, "f")], 60_000);
    await pause(SETTLE_MS);
    expect(tier.cancelled).toBe(false);
    // 50 s since the first sight, past the bound; 30 s since the second request, short of it.
    skew += 30_000;
    await expect.poll(() => tier.cancelled, { timeout: RECHECK_WITHIN_MS }).toBe(true);
    await expect.poll(() => ranSince(main, F, base), { timeout: RECHECK_WITHIN_MS }).toBe(1);

    await done();
    expect(main.current(F)).toBe(true);
  });

  it("the claimant's result: this worktree takes it with no run, and the tier runs on", async () => {
    const { main, tier, base, theirs, done } = await claimedBehindTier();

    // The claimant's run ends and stores F's result at the claimed key.
    theirs.stop();
    await expect.poll(() => main.current(F), { timeout: RECHECK_WITHIN_MS }).toBe(true);
    await pause(SETTLE_MS);
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
    await expect.poll(() => other.current(F), { timeout: RECHECK_WITHIN_MS }).toBe(true);
    expect(rowOf(main, F)).toMatchObject({ pending: "queued", key: rowOf(other, F)?.key });

    await main.scheduler.promote([ref(F, "f")], 60_000);
    await expect.poll(() => main.current(F), { timeout: RECHECK_WITHIN_MS }).toBe(true);
    await pause(SETTLE_MS);
    expect(tier.cancelled).toBe(false);
    expect(ranSince(main, F, base)).toBe(0);

    ours.stop();
    await main.scheduler.idle();
    expect(ranSince(main, F, base)).toBe(0);
  });
});
