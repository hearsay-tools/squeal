import { describe, expect, it } from "vitest";
import type { StatusSnapshot } from "../../src/core/types/status.js";
import { STOP_SLOW_HANDOFF_MS } from "../../src/harness/shared/stop-slow.js";
import { ANTIGRAVITY } from "./antigravity-plugin.js";
import { type E2E, e2eSuite, HOOK_BUDGET_MS, type Hooked } from "./harness.js";
import { SLOW_TUNING } from "./slow-shape.js";
import { SLOW } from "./sources.js";

/*
 * Spec 024 D3, end to end: Antigravity runs its two Stop entries one after
 * the other, the 2 s `stop`, then the waiting `stop-slow` only after a
 * silent `stop`, and a `"continue"` from either keeps the turn going. With a
 * slow file Stop requires (`stop.requireSlowSuite`, `test/slow.test.ts`
 * declared slow and run only while the consumer is idle): a silent `stop`
 * hands the open slow file to `stop-slow`, which waits for it and continues
 * the turn with its failure; after that continuation (`executionNum: 1`)
 * neither entry speaks again. A turn an abort ended (`terminationReason`
 * other than `NO_TOOL_CALL`) or one that paused for background work
 * (`fullyIdle: false`, the human's 2026-11-22 choice) gets silence from both
 * and no hold, and `stop` leaves no handoff for `stop-slow` to act on.
 */

const fixture = e2eSuite();
const SLOWLY = "test/slow.test.ts > doubles slowly";
const POLICY = {
  slow: { include: ["test/slow.test.ts"], ...SLOW_TUNING },
  stop: { requireSlowSuite: true, blockOnKnownFailures: true },
};

const slowCurrent = (s: StatusSnapshot) =>
  s.slowTier?.current === 1 && s.slowTier.pending === 0 && s.knownFailures.length === 0;
const slowPending = (s: StatusSnapshot) => s.slowTier?.pending === 1;

/**
 * A registered consumer in a turn whose edit broke the slow source: the fast
 * tier settled, the slow file pending until the consumer is idle.
 */
async function slowEditInTurn(e: E2E): Promise<void> {
  await e.hook("session-start", e.main);
  await e.daemonReady(e.main);
  await e.settle(e.main, "a passing baseline with the slow file current", slowCurrent);
  const first = await e.hook("post-tool-batch", e.main);
  expect(first.text).toMatch(/^SQUEAL · registered at revision \d+\n/);
  const before = (await e.status(e.main)).revision;
  e.write(e.main, "slow", SLOW(3));
  await e.settleFast(e.main, "the slow file pending in the turn", slowPending, before);
}

/** A hook that printed nothing and exited 0. */
const expectSilent = (hooked: Hooked) =>
  expect(hooked).toMatchObject({ code: 0, stdout: "", stderr: "" });

describe("Antigravity's sequential Stop entries (spec 024 D3)", () => {
  it("stay silent, hold nothing and hand nothing over when a turn aborts or pauses", async (ctx) => {
    const e = fixture(ctx, ANTIGRAVITY, { slow: true, policy: POLICY });
    await slowEditInTurn(e);

    const guards = [{ terminationReason: "USER_CANCELED" }, { fullyIdle: false }];
    for (const guard of guards) {
      const stop = await e.hook("stop", e.main, guard);
      expectSilent(stop);
      expect(stop.ms).toBeLessThan(HOOK_BUDGET_MS);
      // The guarded waiting entry returns before it would wait for any handoff.
      const slow = await e.antigravityHook("stop-slow", e.main, guard);
      expectSilent(slow);
      expect(slow.ms).toBeLessThan(STOP_SLOW_HANDOFF_MS);
      // No handoff: an unguarded waiting entry finds none and holds nothing either.
      expectSilent(await e.antigravityHook("stop-slow", e.main));
      // The next user prompt puts the conversation back in a turn.
      const prompt = await e.antigravityHook("pre-invocation-first", e.main);
      expect(prompt).toMatchObject({ code: 0, stderr: "" });
    }
  }, 240_000);

  it("hand the open slow file to stop-slow, which holds for it and continues once", async (ctx) => {
    const e = fixture(ctx, ANTIGRAVITY, { slow: true, policy: POLICY });
    await slowEditInTurn(e);

    const stop = await e.hook("stop", e.main);
    expectSilent(stop);
    expect(stop.ms).toBeLessThan(HOOK_BUDGET_MS);
    const held = await e.antigravityHook("stop-slow", e.main);
    expect(held).toMatchObject({ code: 0, stderr: "" });
    expect(held.json?.decision).toBe("continue");
    expect(held.text).toContain(`FAIL  ${SLOWLY}\n      PASS -> FAIL`);
    const after = await e.status(e.main);
    expect(after.slowTier).toMatchObject({ current: 1, pending: 0 });
    expect(after.knownFailures.map((f) => f.validity)).toEqual(["current"]);

    // The continued turn's Stop: no news, no stop.blockOnKnownFailures block, no second hold.
    const continued = { stop_hook_active: true };
    expectSilent(await e.hook("stop", e.main, continued));
    const again = await e.antigravityHook("stop-slow", e.main, continued);
    expectSilent(again);
    expect(again.ms).toBeLessThan(STOP_SLOW_HANDOFF_MS);
  }, 240_000);
});
