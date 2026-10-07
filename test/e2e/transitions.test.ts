import { describe, expect, it } from "vitest";
import { expectAgrees, headerRevision } from "./agree.js";
import { e2eSuite, HOOK_BUDGET_MS, hasNodeModulesAbove, MATH } from "./harness.js";

/*
 * Spec 001 goals 1 to 3 and Testing, end to end: one PASS -> FAIL, then one
 * FAIL -> PASS, on PostToolBatch, and nothing for PASS -> PASS, for a failure
 * that keeps its diagnostic, or for a break and recovery between two
 * deliveries. Every delivery agrees with `squeal status --json`.
 */

const fixture = e2eSuite();
const ADDS = "test/math.test.ts > math > adds";
const quiet = (s: { knownFailures: readonly unknown[] }) => s.knownFailures.length === 0;
const failing = (s: { knownFailures: readonly { validity: string }[] }) =>
  s.knownFailures.length === 1 && s.knownFailures[0]?.validity === "current";

describe("transitions on PostToolBatch", () => {
  it("delivers one PASS -> FAIL and one FAIL -> PASS, nothing in between", async (ctx) => {
    const e = fixture(ctx);
    expect(hasNodeModulesAbove(e.plugin)).toBe(false);

    // No store yet: SessionStart only spawns the daemon (D9).
    const start = await e.hook("session-start", e.main);
    expect(start).toMatchObject({ code: 0, stderr: "", stdout: "" });
    expect(start.ms).toBeLessThan(HOOK_BUDGET_MS);
    await e.daemonReady(e.main);
    await e.settle(e.main, "a passing baseline", (s) => s.counts.current > 0 && quiet(s));

    // The first PostToolBatch registers the consumer.
    const registered = await e.hook("post-tool-batch", e.main);
    expect(registered.text).toMatch(/^SQUEAL · registered at revision \d+\n/);
    expect(registered.text).toContain("Known failures: 0");
    expectAgrees(registered.text, await e.status(e.main));

    // PASS -> PASS with new content: a run, and nothing to say.
    const same = await e.edit(e.main, "math", MATH(), quiet);
    expect(e.runs(e.main).some((r) => r.revision === same.revision)).toBe(true);
    expect(await e.hook("post-tool-batch", e.main)).toMatchObject({ stdout: "", code: 0 });

    // PASS -> FAIL.
    const broken = await e.edit(e.main, "math", MATH("-"), failing);
    const fail = await e.hook("post-tool-batch", e.main);
    expect(fail).toMatchObject({ code: 0, stderr: "" });
    expect(fail.ms).toBeLessThan(HOOK_BUDGET_MS);
    expect(fail.text).toMatch(/^SQUEAL · 1 check changed at revision \d+\n/);
    expect(headerRevision(fail.text ?? "")).toBe(broken.revision);
    expect(fail.text).toContain(
      `FAIL  ${ADDS}\n      PASS -> FAIL, seen by Squeal's run at revision ${broken.revision}\n      expected -1 to be 3`,
    );
    expect(fail.text).not.toContain("pending;");
    expectAgrees(fail.text, await e.status(e.main));

    // Nothing in between: an empty boundary, then FAIL -> FAIL with the same diagnostic.
    expect((await e.hook("post-tool-batch", e.main)).stdout).toBe("");
    const still = await e.edit(e.main, "math", MATH("-"), failing);
    expect(still.revision).toBeGreaterThan(broken.revision);
    expect(e.runs(e.main).some((r) => r.revision === still.revision)).toBe(true);
    expect((await e.hook("post-tool-batch", e.main)).stdout).toBe("");

    // FAIL -> PASS.
    const fixed = await e.edit(e.main, "math", MATH(), quiet);
    const pass = await e.hook("post-tool-batch", e.main);
    expect(pass.text).toMatch(/^SQUEAL · 1 check changed at revision \d+\n/);
    expect(headerRevision(pass.text ?? "")).toBe(fixed.revision);
    expect(pass.text).toContain(`PASS  ${ADDS}\n      FAIL -> PASS`);
    expect(pass.text).not.toContain("FAIL  ");
    expectAgrees(pass.text, await e.status(e.main));

    expect((await e.hook("post-tool-batch", e.main)).stdout).toBe("");
    const end = await e.hook("session-end", e.main);
    expect(end).toMatchObject({ code: 0, stdout: "", stderr: "" });
  }, 240_000);

  it("stays silent when a check breaks and recovers between two PostToolBatch calls", async (ctx) => {
    const e = fixture(ctx);
    await e.hook("session-start", e.main);
    await e.daemonReady(e.main);
    await e.settle(e.main, "a passing baseline", (s) => s.counts.current > 0 && quiet(s));
    const registered = await e.hook("post-tool-batch", e.main);
    expect(registered.text).toContain("registered at revision");

    const broken = await e.edit(e.main, "math", MATH("-"), failing);
    const fixed = await e.edit(e.main, "math", MATH(), quiet);
    expect(fixed.revision).toBeGreaterThan(broken.revision);

    const after = await e.hook("post-tool-batch", e.main);
    expect(after).toMatchObject({ code: 0, stdout: "", stderr: "" });

    // The break was observed: the check's history has both transitions.
    const why = await e.cli(e.main, ["why", ADDS]);
    expect(why.stdout).toMatch(/PASS -> FAIL[\s\S]*FAIL -> PASS/);
    const status = await e.status(e.main);
    expect(status.knownFailures).toEqual([]);
    expect(status.revision).toBe(fixed.revision);
  }, 240_000);
});
