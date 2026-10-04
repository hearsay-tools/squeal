import { describe, expect, it } from "vitest";
import { formatCheck } from "../../src/core/status/index.js";
import type { StatusSnapshot } from "../../src/core/types/index.js";
import { expectAgrees } from "./agree.js";
import { type E2E, e2eSuite, HOOK_BUDGET_MS, MATH, SLOW, until } from "./harness.js";

/*
 * Spec 001 D9 policy hooks, end to end, and review wave 3 S1: PreToolUse
 * denies one edit on a regression and leaves recoveries for PostToolBatch;
 * Stop with `stop.blockOnKnownFailures` blocks only on failures current at
 * the revision and names failures whose re-run is in flight as pending.
 */

const fixture = e2eSuite();
const ADDS = "test/math.test.ts > math > adds";
const MULTIPLIES = "test/math.test.ts > math > multiplies";
const SLOWLY = "test/slow.test.ts > doubles slowly";

const names = (s: StatusSnapshot) => s.knownFailures.map((f) => formatCheck(f.check));
const failingOnly =
  (...expected: string[]) =>
  (s: StatusSnapshot) =>
    s.knownFailures.every((f) => f.validity === "current") &&
    JSON.stringify(names(s).sort()) === JSON.stringify([...expected].sort());

async function registered(e: E2E): Promise<void> {
  await e.hook("session-start", e.main);
  await e.daemonReady(e.main);
  await e.settle(e.main, "a passing baseline", failingOnly());
  const first = await e.hook("post-tool-batch", e.main);
  expect(first.text).toMatch(/^SQUEAL · registered at revision \d+\n/);
}

describe("PreToolUse with interrupt.onRegression", () => {
  it("denies once on a regression and leaves the recovery for PostToolBatch", async (ctx) => {
    const e = fixture(ctx);
    await registered(e);
    await e.edit(e.main, "math", MATH("+", "+"), failingOnly(MULTIPLIES));
    const told = await e.hook("post-tool-batch", e.main);
    expect(told.text).toContain(`FAIL  ${MULTIPLIES}\n      PASS -> FAIL`);

    // One change: multiplies recovers, adds regresses.
    await e.edit(e.main, "math", MATH("-", "*"), failingOnly(ADDS));
    const deny = await e.hook("pre-tool-use", e.main);
    expect(deny).toMatchObject({ code: 0, stderr: "" });
    expect(deny.ms).toBeLessThan(HOOK_BUDGET_MS);
    expect(deny.json?.hookSpecificOutput?.permissionDecision).toBe("deny");
    expect(deny.text).toMatch(/^SQUEAL · 1 check changed at revision \d+\n/);
    expect(deny.text).toContain(`FAIL  ${ADDS}\n      PASS -> FAIL`);
    expect(deny.text).not.toContain(MULTIPLIES);
    expect(deny.text).toContain("denied this Edit call, so the edit was not applied");
    expectAgrees(deny.text, await e.status(e.main));

    // The same regression never denies twice.
    expect(await e.hook("pre-tool-use", e.main)).toMatchObject({ code: 0, stdout: "" });

    // The recovery is still there for the tool boundary, and only the recovery.
    const recovery = await e.hook("post-tool-batch", e.main);
    expect(recovery.text).toMatch(/^SQUEAL · 1 check changed at revision \d+\n/);
    expect(recovery.text).toContain(`PASS  ${MULTIPLIES}\n      FAIL -> PASS`);
    expect(recovery.text).not.toContain(ADDS);
    expectAgrees(recovery.text, await e.status(e.main));
    expect((await e.hook("post-tool-batch", e.main)).stdout).toBe("");

    // A recovery alone never denies.
    await e.edit(e.main, "math", MATH(), failingOnly());
    expect(await e.hook("pre-tool-use", e.main)).toMatchObject({ code: 0, stdout: "" });
    const fixed = await e.hook("post-tool-batch", e.main);
    expect(fixed.text).toContain(`PASS  ${ADDS}\n      FAIL -> PASS`);
  }, 240_000);
});

describe("Stop with stop.blockOnKnownFailures", () => {
  it("blocks only on current failures and names pending ones as pending", async (ctx) => {
    const e = fixture(ctx, { slow: true, policy: { stop: { blockOnKnownFailures: true } } });
    await registered(e);
    await e.edit(e.main, "math", MATH("-"), failingOnly(ADDS));
    const slowFailed = await e.edit(e.main, "slow", SLOW(3), failingOnly(ADDS, SLOWLY));
    const told = await e.hook("post-tool-batch", e.main);
    expect(told.text).toContain(`FAIL  ${SLOWLY}\n      PASS -> FAIL`);

    // New content for the slow file: its failure is pending while the run sleeps.
    const pending = await rerunSlow(e, slowFailed.revision);
    const stop = await e.hook("stop", e.main);
    expect(stop).toMatchObject({ code: 0, stderr: "" });
    expect(stop.ms).toBeLessThan(HOOK_BUDGET_MS);
    expect(stop.json?.decision).toBe("block");
    const at = pending.revision;
    expect(stop.text).toContain(
      `Squeal policy stop.blockOnKnownFailures is on and 1 known failure exists at revision ${at}: ${ADDS}.`,
    );
    expect(stop.text).toContain(
      `1 check last failed at an earlier revision and its re-run at revision ${at} is pending: ` +
        `${SLOWLY} (failed at revision ${slowFailed.revision}).`,
    );
    // The block happened while the re-run was in flight.
    const during = await e.status(e.main);
    expect(during.knownFailures.find((f) => f.validity === "pending")).toBeDefined();

    // A Stop that fires while the block keeps the agent going never blocks again.
    const again = await e.hook("stop", e.main, { stop_hook_active: true });
    expect(again.json?.decision).toBeUndefined();

    // With only a pending failure left, Stop does not block.
    const quiet = await e.edit(e.main, "math", MATH(), failingOnly(SLOWLY));
    const recovered = await e.hook("post-tool-batch", e.main);
    expect(recovered.text).toContain(`PASS  ${ADDS}\n      FAIL -> PASS`);
    await rerunSlow(e, quiet.revision);
    const free = await e.hook("stop", e.main);
    expect(free).toMatchObject({ code: 0, stderr: "" });
    expect(free.json?.decision).toBeUndefined();
    expect(free.text ?? "").not.toContain("stop.blockOnKnownFailures");
  }, 300_000);
});

/** Writes a still-broken slow source with new content and waits until its failure reads pending. */
async function rerunSlow(e: E2E, after: number): Promise<StatusSnapshot> {
  e.write(e.main, "slow", SLOW(3));
  return until("the slow failure to be pending", 30_000, async () => {
    const s = await e.status(e.main);
    const slow = s.knownFailures.find((f) => f.check.testPath === "test/slow.test.ts");
    return s.revision > after && slow?.validity === "pending" ? s : null;
  });
}
