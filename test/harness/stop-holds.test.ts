import { describe, expect, it } from "vitest";
import { readStopHolds } from "../../src/core/delivery/turn.js";
import { MAIN_AGENT } from "../../src/core/types/delivery.js";
import { runHook } from "../../src/harness/claude-code/hooks.js";
import { runCodexHook } from "../../src/harness/codex/hooks.js";
import { STOP_SLOW_HANDOFF_MS } from "../../src/harness/shared/stop-slow.js";
import { codexRecorded } from "./codex/helpers.js";
import { recorded, type SquealRepo } from "./helpers.js";
import {
  decision,
  deps,
  edit,
  HARNESSES,
  type Harness,
  landSlow,
  queueSlowAgain,
  repo,
  slowKey,
  stopBoth,
  turnOf,
} from "./stop-slow-helpers.js";

/*
 * Spec 019 D4 step 3 (row 019-14): Stop may hold the agent `stop.maxHolds`
 * times in one turn for the checks it requires, counted by Squeal per
 * consumer from the user's prompt, not read from `stop_hook_active`. So a
 * Stop after a fast-failure message (`stop-wait.md` C2) and one after more
 * edits (C3) still wait while holds remain; Claude Code and Codex alike.
 * Other policies and a SubagentStop keep `stop_hook_active` (004 D7).
 */

const ACTIVE = { stop_hook_active: true };

/** The waiting entry's block at its 0.3 s bound with the slow file not current at `revision`. */
const atBound = (revision: number) =>
  new RegExp(
    `^Squeal policy stop.requireSlowSuite is on and after 0.3 s 1 slow test file is still not current at revision ${revision}: test/e2e/slow.test.ts\\.`,
  );

/** A Stop the harness continued after an earlier Stop spoke or blocked, both entries at once. */
const continued = (harness: Harness, r: SquealRepo, during?: () => void) =>
  stopBoth(harness, r, during, 150, ACTIVE);

/** A user prompt: a new turn, so no hold counted yet. */
async function prompt(harness: Harness, r: SquealRepo): Promise<void> {
  if (harness.name === "claude-code") {
    await runHook("user-prompt-submit", recorded("user-prompt-submit", r.root), deps);
  } else {
    const input = codexRecorded("exec", "user-prompt-submit", r.root);
    await runCodexHook("user-prompt-submit", input, deps);
  }
}

/** The main agent's holds this turn; a subagent may be registered beside it. */
function holds(r: SquealRepo): number {
  const main = r.store.consumers.list(r.worktreeId).find((c) => c.consumer.agentId === MAIN_AGENT);
  if (main === undefined) throw new Error("no main agent");
  return readStopHolds(r.store, main.consumer);
}

describe.each(HARNESSES)("stop.maxHolds, $name (019 D4.3)", (harness) => {
  describe.each([1, 2])("maxHolds %i", (maxHolds) => {
    const policy = { requireSlowSuite: true, slowWaitMs: 300, maxHolds };

    it("C2: a Stop after a fast-failure message still waits, up to maxHolds holds", async () => {
      const r = await repo(harness, policy);
      r.apply(r.fail());
      slowKey(r, "queued");
      const spoke = await stopBoth(harness, r);
      // The 2 s entry told the new failure; the turn goes on, and the waiting entry stayed silent.
      expect(spoke.quick).not.toEqual({});
      expect(spoke.waiting).toEqual({});
      expect(holds(r)).toBe(0);

      for (let hold = 1; hold <= maxHolds; hold++) {
        const out = await continued(harness, r);
        expect(out.quick).toEqual({});
        expect(out.waiting.decision).toBe("block");
        expect(out.waiting.reason).toMatch(atBound(2));
        expect(holds(r)).toBe(hold);
        expect(turnOf(r)).toBe("in-turn");
      }
      const last = await continued(harness, r);
      expect(last).toMatchObject({ quick: {}, waiting: {} });
      expect(last.ms).toBeLessThan(STOP_SLOW_HANDOFF_MS / 2);
      expect(turnOf(r)).toBe("idle");
    });

    it("C3: a Stop after a hold and more edits waits again only while holds remain", async () => {
      const r = await repo(harness, policy);
      const first = await stopBoth(harness, r);
      expect(first.waiting.reason).toMatch(atBound(1));
      edit(r);
      const out = await continued(harness, r);
      expect(out.quick).toEqual({});
      if (maxHolds === 1) {
        expect(out.waiting).toEqual({});
        expect(out.ms).toBeLessThan(STOP_SLOW_HANDOFF_MS / 2);
        expect(turnOf(r)).toBe("idle");
      } else {
        expect(out.waiting.reason).toMatch(atBound(2));
        expect(holds(r)).toBe(2);
      }
    });

    it("C3: after a slow failure's hold and a fix, the next Stop waits for the new run while holds remain", async () => {
      const r = await repo(harness, policy);
      const first = await stopBoth(harness, r, () => landSlow(r, "fail"), 100);
      expect(first.waiting.reason).toMatch(
        /1 check fails: test\/e2e\/slow.test.ts > ledger > posts/,
      );
      queueSlowAgain(r);
      const out = await continued(harness, r, () => landSlow(r, "fail", "slow2", "still broken"));
      expect(out.quick).toEqual({});
      if (maxHolds === 1) {
        expect(out.waiting).toEqual({});
      } else {
        expect(out.waiting.decision).toBe("block");
        expect(out.waiting.reason).toContain("still broken");
      }
    });
  });

  it("a prompt starts a turn: the holds count from zero again", async () => {
    const r = await repo(harness, { requireSlowSuite: true, slowWaitMs: 300 });
    expect((await stopBoth(harness, r)).waiting.decision).toBe("block");
    expect(holds(r)).toBe(1);
    await prompt(harness, r);
    expect(holds(r)).toBe(0);
    edit(r);
    const out = await stopBoth(harness, r);
    expect(out.waiting.reason).toMatch(atBound(2));
    expect(holds(r)).toBe(1);
  });

  it("the count lasts while the turn ends silently and goes on: a pass, then a continued Stop", async () => {
    const r = await repo(harness, { requireSlowSuite: true, slowWaitMs: 300 });
    expect((await stopBoth(harness, r)).waiting.decision).toBe("block");
    // Silent: the file passes; the turn ends, idle, and the hold is still counted.
    edit(r);
    landSlow(r, "pass");
    expect(await stopBoth(harness, r, () => {}, 300, ACTIVE)).toMatchObject({
      quick: {},
      waiting: {},
    });
    expect(turnOf(r)).toBe("idle");
    expect(holds(r)).toBe(1);
  });

  describe.each([1, 2])("without the waiting entry known to run, maxHolds %i", (maxHolds) => {
    it("the 2 s entry holds at once, up to maxHolds times in a turn", async () => {
      const r = await repo(harness, { requireSlowSuite: true, maxHolds }, false);
      for (let hold = 1; hold <= maxHolds; hold++) {
        const out = decision(await harness.stop(r, hold === 1 ? {} : ACTIVE));
        expect(out.decision).toBe("block");
        expect(out.reason).toMatch(
          /^Squeal policy stop.requireSlowSuite is on and 1 slow test file is not current at revision 1: test\/e2e\/slow.test.ts\./,
        );
        expect(holds(r)).toBe(hold);
      }
      expect(decision(await harness.stop(r, ACTIVE))).toEqual({});
      expect(turnOf(r)).toBe("idle");
    });
  });

  it("another policy still never blocks a continued Stop: blockOnKnownFailures", async () => {
    const r = await repo(harness, {
      requireSlowSuite: true,
      slowWaitMs: 300,
      maxHolds: 2,
      blockOnKnownFailures: true,
    });
    r.apply(r.fail());
    slowKey(r, "queued");
    const first = await stopBoth(harness, r);
    expect(first.quick.reason).toMatch(/^Squeal policy stop.blockOnKnownFailures is on/);
    expect(first.waiting).toEqual({});
    // Continued: no second known-failure block, but the required slow file still holds.
    const out = await continued(harness, r);
    expect(out.quick).toEqual({});
    expect(out.waiting.reason).toMatch(atBound(2));
  });
});

describe("a SubagentStop keeps one hold whatever stop.maxHolds says (004 D7)", () => {
  it.each(HARNESSES)("$name", async (harness) => {
    const r = await repo(harness, { requireSlowSuite: true, maxHolds: 3 }, false);
    const claude = harness.name === "claude-code";
    const start = claude
      ? () => runHook("session-start", recorded("subagent-start", r.root), deps)
      : () => runCodexHook("subagent-start", codexRecorded("exec", "subagent-start", r.root), deps);
    const stop = (overrides: object = {}) =>
      claude
        ? runHook("stop", recorded("subagent-stop", r.root, overrides), deps)
        : runCodexHook(
            "subagent-stop",
            codexRecorded("exec", "subagent-stop", r.root, overrides),
            deps,
          );
    await start();
    expect(decision(await stop()).decision).toBe("block");
    expect(decision(await stop(ACTIVE)).decision).toBeUndefined();
    expect(holds(r)).toBe(0);
  });
});
