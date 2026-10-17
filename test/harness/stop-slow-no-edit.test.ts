import { describe, expect, it } from "vitest";
import { DEFAULT_POLICY, type PolicyFile } from "../../src/core/types/index.js";
import { FILE, type SquealRepo, squealRepo } from "./helpers.js";
import {
  HARNESSES,
  type Harness,
  markStopWait,
  SLOW_FILE,
  slowKey,
  stopBoth,
  turnOf,
} from "./stop-slow-helpers.js";

/*
 * Task 004-67 (issue 19, decided by the human 2026-10-17): with
 * `stop.requireSlowSuite` on, a main agent whose worktree had no revision
 * since its consumer registered is not held at Stop for its slow files. The
 * daemon's record of revisions decides: one revision since then, or a
 * daemon that may have missed an edit, restores the wait.
 */

const ON: NonNullable<PolicyFile["stop"]> = { requireSlowSuite: true, slowWaitMs: 400 };

/** Revision 1 passes `math > adds` and queues the slow file; then the agent registers, in a turn. */
async function readOnly(harness: Harness): Promise<SquealRepo> {
  const r = squealRepo();
  r.apply(r.pass());
  r.policy({ slow: { ...DEFAULT_POLICY.slow, include: [SLOW_FILE.path, FILE.path] }, stop: ON });
  slowKey(r, "queued");
  await harness.startTurn(r);
  markStopWait(r, harness.name);
  return r;
}

describe.each(HARNESSES)("a session that changed nothing, $name (004-67)", (harness) => {
  it("is not held for a slow file not current: both entries end within the 2 s budget", async () => {
    const r = await readOnly(harness);
    const out = await stopBoth(harness, r);
    expect(out.quick).toEqual({});
    expect(out.waiting).toEqual({});
    expect(out.ms).toBeLessThan(2_000);
    expect(turnOf(r)).toBe("idle");
  });

  it("waits again after one revision since registration", async () => {
    const r = await readOnly(harness);
    r.apply();
    slowKey(r, "queued", "slow2");
    const out = await stopBoth(harness, r);
    expect(out.quick).toEqual({});
    expect(out.waiting.decision).toBe("block");
    expect(out.waiting.reason).toMatch(
      /^Squeal policy stop.requireSlowSuite is on and after 0.4 s 1 slow test file is still not current at revision 2: test\/e2e\/slow.test.ts\./,
    );
    expect(turnOf(r)).toBe("in-turn");
  });

  it("waits when the daemon recorded is not the one that had scanned at registration", async () => {
    const r = await readOnly(harness);
    const daemon = r.store.worktrees.get(r.worktreeId)?.daemon;
    if (daemon === null || daemon === undefined) throw new Error("no daemon");
    r.store.worktrees.setDaemon(r.worktreeId, { ...daemon, startedAt: daemon.startedAt + 1 });
    const out = await stopBoth(harness, r);
    expect(out.waiting.decision).toBe("block");
    expect(turnOf(r)).toBe("in-turn");
  });
});
