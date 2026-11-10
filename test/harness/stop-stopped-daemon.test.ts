import { describe, expect, it } from "vitest";
import { readPolicy } from "../../src/core/daemon/policy.js";
import { createDelivery } from "../../src/core/delivery/delivery.js";
import { readStopHolds } from "../../src/core/delivery/turn.js";
import { releaseLintGroup } from "../../src/core/lint/pass/commit-entry.js";
import { markStopped } from "../../src/core/presence/events.js";
import type { EpochMs } from "../../src/core/types/common.js";
import { fixedStatus } from "../delivery/fakes.js";
import { hookedRepo } from "../lint/wiring/rig.js";
import type { SquealRepo } from "./helpers.js";
import { committedRepo, LINT_AT_STOP, pendingLint } from "./stop-no-edit-helpers.js";
import {
  decision,
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
 * else to say stays silent. A daemon that died holds as before. Review
 * 0.1.429 B1: a failure already found still holds beside an open check.
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

const BLOCKING =
  "Squeal policy lint.blocking is on and 1 file went to fail lint since this session started: src/a.js (1 finding).";

/** The main agent's holds this turn. */
const holds = (r: SquealRepo): number => readStopHolds(r.store, mainConsumer(r));

/**
 * Review 0.1.429 B1: a lint group at `stop` with `lint.blocking`. After the
 * agent registered, its edit made `src/a.js` fail lint, and the group linted
 * it, so the failure is current and its own. `pending`: an untouched check
 * waits to lint too. Then the daemon is stopped by request.
 */
async function failing(harness: Harness, pending: boolean): Promise<SquealRepo> {
  const policy = { checks: [{ name: "lint", lint: true, at: "stop" }], stop: { slowWaitMs: 400 } };
  const hooked = await hookedRepo(
    { "src/a.js": "ok\n" },
    { enabled: true, blocking: true },
    policy,
  );
  const { r, tree } = hooked;
  await harness.startTurn(r);
  markStopWait(r, harness.name);
  await hooked.edit({ "src/a.js": "bad no-undef\n" });
  const blobOf = (path: string) => tree.source.file(path)?.hash ?? null;
  releaseLintGroup(r.repo.commonDir, readPolicy(r.root), r.worktreeId, "lint", blobOf);
  await hooked.settle();
  if (pending) pendingLint(r);
  stopByRequest(r, true);
  return r;
}

describe.each(HARNESSES)(
  "a failure already found, daemon stopped by request, $name (review 0.1.429 B1)",
  (harness) => {
    it.each([false, true])(
      "the 2 s entry holds for it once; an untouched check pending (%s) changes nothing",
      async (pending) => {
        const r = await failing(harness, pending);
        const first = await stopBoth(harness, r);
        expect(first.quick.decision).toBe("block");
        expect(first.quick.reason).toContain(BLOCKING);
        expect(first.quick.reason?.includes("Stop does not hold for the checks it requires")).toBe(
          pending,
        );
        expect(holds(r)).toBe(1);
        const again = await stopBoth(harness, r, () => {}, 300, { stop_hook_active: true });
        expect(again).toMatchObject({ quick: {}, waiting: {} });
        expect(holds(r)).toBe(1);
      },
    );

    it.each([false, true])(
      "the waiting entry holds for it once the 2 s entry ended the turn; untouched check pending: %s",
      async (pending) => {
        const r = await failing(harness, pending);
        const ended = await createDelivery(r.store, { status: fixedStatus() }).endTurn(
          mainConsumer(r),
          { handoff: true },
        );
        expect(ended).toBe(true);
        const waiting = decision(await harness.stopSlow(r));
        expect(waiting.decision).toBe("block");
        expect(waiting.reason).toContain(BLOCKING);
        expect(holds(r)).toBe(1);
      },
    );
  },
);
