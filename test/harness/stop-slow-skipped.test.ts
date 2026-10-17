import { describe, expect, it } from "vitest";
import { publishSlowActivity } from "../../src/core/slow/state.js";
import { DEFAULT_POLICY } from "../../src/core/types/index.js";
import { runHook } from "../../src/harness/claude-code/index.js";
import { recorded, type SquealRepo, squealRepo } from "./helpers.js";
import {
  decision,
  deps,
  HARNESSES,
  repo,
  SLOW_FILE,
  slowKey,
  stopBoth,
  turnOf,
} from "./stop-slow-helpers.js";

/*
 * Spec 004 D8 as amended 2026-10-17 (task 004-65, issues #3 and #16): with
 * `stop.requireSlowSuite` on, Stop does not wait out `stop.slowWaitMs` for a
 * slow tier its precondition skipped, since nothing will run it: it holds
 * the agent once naming the reason, and SubagentStop blocks naming it (D9).
 */

const REASON = "dist/index.js matches no file (slow.precondition.exists)";
const SLOW_WAIT_MS = 20_000;
const SKIPPED =
  /1 slow test file is not current at revision \d+: test\/e2e\/slow\.test\.ts\. The slow tier was skipped: dist\/index\.js matches no file \(slow\.precondition\.exists\)\. Squeal runs them once the precondition holds; `.*squeal.* run --slow --wait` checks it again\.\n\n/;

/** The slow tier found its precondition unmet: the file left the queue with no result. */
function skip(r: SquealRepo): void {
  slowKey(r, null);
  publishSlowActivity(r.store, r.worktreeId, { kind: "skipped", reason: REASON, since: 1 });
}

describe.each(HARNESSES)(
  "Stop on a skipped slow tier, $name (004-65)",
  { timeout: 30_000 },
  (harness) => {
    it("holds the agent once naming the reason, without waiting out stop.slowWaitMs", async () => {
      const r = await repo(harness, { requireSlowSuite: true, slowWaitMs: SLOW_WAIT_MS });
      skip(r);
      const out = await stopBoth(harness, r);
      expect(out.quick).toEqual({});
      expect(out.waiting.decision).toBe("block");
      expect(out.waiting.reason).toMatch(SKIPPED);
      expect(out.ms).toBeLessThan(SLOW_WAIT_MS / 2);
      expect(turnOf(r)).toBe("in-turn");
      // Once: the Stop the block led to ends the turn.
      const again = await harness.stopSlow(r, { stop_hook_active: true });
      expect(decision(again)).toEqual({});
    });
  },
);

describe("SubagentStop on a skipped slow tier, claude-code (004-65)", () => {
  it("blocks naming the reason", async () => {
    const r = squealRepo();
    r.policy({
      slow: { ...DEFAULT_POLICY.slow, include: [SLOW_FILE.path] },
      stop: { requireSlowSuite: true },
    });
    await runHook("session-start", recorded("session-start", r.root), deps);
    await runHook("user-prompt-submit", recorded("user-prompt-submit", r.root), deps);
    r.apply(r.pass());
    await runHook("session-start", recorded("subagent-start", r.root), deps);
    skip(r);
    const out = decision(await runHook("stop", recorded("subagent-stop", r.root), deps));
    expect(out.decision).toBe("block");
    expect(out.reason).toMatch(SKIPPED);
  });
});
