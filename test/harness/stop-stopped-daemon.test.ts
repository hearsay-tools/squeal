import { describe, expect, it } from "vitest";
import { readStopHolds } from "../../src/core/delivery/turn.js";
import { markStopped } from "../../src/core/presence/events.js";
import type { EpochMs } from "../../src/core/types/common.js";
import type { SquealRepo } from "./helpers.js";
import { committedRepo, LINT_AT_STOP, pendingLint } from "./stop-no-edit-helpers.js";
import {
  HARNESSES,
  type Harness,
  mainConsumer,
  markStopWait,
  type Out,
  stopBoth,
} from "./stop-slow-helpers.js";

/*
 * Row 011-312 (gh-153): while the daemon is stopped by request (`squeal
 * stop`, `--until-start`), no daemon can run the checks Stop requires, so
 * they hold nothing. A Stop that speaks anyway says so in one line naming
 * `squeal start`, never a command that needs a daemon; one with nothing
 * else to say stays silent. A daemon that died holds as before.
 */

const INFO =
  "Squeal: the daemon is stopped by request, so Stop does not hold for the checks it requires: at revision 1, 1 lint check is not linted: untouched.js. `squeal start` starts a daemon, which runs them.";

/**
 * A session in a turn with one revision since it registered, and one lint
 * check waiting to lint; the waiting entry's bound is `slowWaitMs`.
 */
async function edited(harness: Harness, slowWaitMs = 400): Promise<SquealRepo> {
  const r = committedRepo({ ...LINT_AT_STOP, stop: { slowWaitMs } });
  await harness.startTurn(r);
  markStopWait(r, harness.name);
  r.apply();
  pendingLint(r);
  return r;
}

/** `squeal stop` cleared the daemon's record and left its mark after the last heartbeat. */
function stopByRequest(r: SquealRepo, untilStart: boolean): void {
  r.store.worktrees.setDaemon(r.worktreeId, null);
  markStopped(r.store, r.worktreeId, (Date.now() + 1) as EpochMs, null, untilStart);
}

/** What a Stop entry said, as text: Claude Code's context or block reason, Codex's reason. */
function said(out: Out): string {
  if (out.stdout.trim() === "") return "";
  const parsed = JSON.parse(out.stdout) as {
    reason?: string;
    hookSpecificOutput?: { additionalContext?: string };
  };
  return parsed.reason ?? parsed.hookSpecificOutput?.additionalContext ?? "";
}

describe.each(HARNESSES)("a daemon stopped by request, $name (011-312)", (harness) => {
  describe.each([false, true])("--until-start %s", (untilStart) => {
    it("holds nothing for an open lint check; Stop's news carries one line naming squeal start", async () => {
      const r = await edited(harness);
      stopByRequest(r, untilStart);
      const [quick, waiting] = await Promise.all([harness.stop(r), harness.stopSlow(r)]);
      expect(said(waiting)).toBe("");
      const text = said(quick);
      expect(text).toContain(INFO);
      expect(text).not.toContain("--wait");
      expect(readStopHolds(r.store, mainConsumer(r))).toBe(0);
    });

    it("a Stop with nothing else to say stays silent, and the waiting entry waits for nothing", async () => {
      const r = await edited(harness, 60_000);
      stopByRequest(r, untilStart);
      await stopBoth(harness, r);
      const again = await stopBoth(harness, r);
      expect(again.quick).toEqual({});
      expect(again.waiting).toEqual({});
      // Not the 10 s a daemon down is waited for, nor the 60 s bound.
      expect(again.ms).toBeLessThan(5_000);
    });
  });
});

describe.each(HARNESSES)("a daemon that died, $name (011-312)", (harness) => {
  it("holds as before at the bound, naming the group's run command", async () => {
    const r = await edited(harness);
    r.daemon("stale", Date.now() - 60_000);
    // The first Stop tells that no daemon runs: news, so the waiting entry leaves it.
    await stopBoth(harness, r);
    const out = await stopBoth(harness, r);
    expect(out.waiting.decision).toBe("block");
    expect(out.waiting.reason).toContain(
      "after 0.4 s 1 lint check is still not linted at revision 1: untouched.js. `squeal run lint --wait` waits for their results.",
    );
    expect(out.waiting.reason).not.toContain("stopped by request");
  });
});
