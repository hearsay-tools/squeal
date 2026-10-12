import { describe, expect, it } from "vitest";
import { refinedMetaKey } from "../../src/core/types/index.js";
import type { HookDeps } from "../../src/harness/shared/hook.js";
import type { SquealRepo } from "./helpers.js";
import {
  decision,
  deps,
  HARNESSES,
  type Harness,
  landSlow,
  repo,
  SLOW_FILE,
  slowKey,
  turnOf,
} from "./stop-slow-helpers.js";

/*
 * Review wave 13an (task 001-302): what the waiting Stop owes beyond the
 * files and keys the 2 s entry's silent end recorded. B1: that end left the
 * runner part of its revision unfinished, so a slow file it lists later, up
 * to that revision, is owed even when its failure is current at the first
 * read. S2 (the human): an owed file stays owed at a newer key, so its
 * failure there is decided even when no poll saw it queued. Clock calls as
 * in `stop-slow-boundary.test.ts`: 1 is the handoff's start, 2 the first
 * poll, 3 the second.
 */

/** The entry's clock, running `at[n]` at its `n`th call. */
function clock(at: Readonly<Record<number, () => void>>): HookDeps {
  let calls = 0;
  return {
    ...deps,
    now: () => {
      calls++;
      at[calls]?.();
      return Date.now();
    },
  };
}

/** The slow file not listed yet, and the runner part of revision 1 that lists it unfinished. */
async function unlisted(harness: Harness): Promise<SquealRepo> {
  const r = await repo(harness, { requireSlowSuite: true, slowWaitMs: 400 });
  r.store.testFileKeys.remove(r.worktreeId, [SLOW_FILE]);
  r.store.meta.set(refinedMetaKey(r.worktreeId), "0");
  return r;
}

/** The runner part lists and queues the slow file, its run lands, and refinement ends at `refined`. */
function listAndLand(r: SquealRepo, outcome: "pass" | "fail", refined = "1"): void {
  r.store.transaction(() => {
    slowKey(r, "queued");
    landSlow(r, outcome);
    r.store.meta.set(refinedMetaKey(r.worktreeId), refined);
  });
}

/** A new revision moves the slow file to `slow2` and queues it, as the scheduler does. */
function queueSlowAgain(r: SquealRepo): void {
  r.apply();
  slowKey(r, "queued", "slow2");
  r.sink.refresh(r.worktreeId, r.store.revisions.latest(r.worktreeId)?.number ?? 0, {
    checkpointId: null,
  });
}

/** The 2 s entry alone, then `between`, then the waiting entry with `hookDeps`. */
async function stopThenWait(
  harness: Harness,
  r: SquealRepo,
  between: () => void,
  hookDeps: HookDeps = deps,
) {
  const quick = decision(await harness.stop(r));
  between();
  const waiting = decision(await harness.stopSlow(r, {}, hookDeps));
  return { quick, waiting };
}

const FAILS = /ran at revision \d+: 1 check fails: test\/e2e\/slow.test.ts > ledger > posts\./;

describe.each(HARNESSES)("what the waiting Stop owes, $name (13an)", (harness) => {
  it("B1: blocks on a slow file listed and failed after the turn ended, before its first read", async () => {
    const r = await unlisted(harness);
    const out = await stopThenWait(harness, r, () => listAndLand(r, "fail"));
    expect(out.quick).toEqual({});
    expect(out.waiting.decision).toBe("block");
    expect(out.waiting.reason).toMatch(FAILS);
    expect(turnOf(r)).toBe("in-turn");
  });

  it("B1 control: a slow file listed and passed before its first read stays silent", async () => {
    const r = await unlisted(harness);
    const out = await stopThenWait(harness, r, () => listAndLand(r, "pass"));
    expect(out).toEqual({ quick: {}, waiting: {} });
    expect(turnOf(r)).toBe("idle");
  });

  it("B1: blocks on a slow file listed and failed during its first read", async () => {
    const r = await unlisted(harness);
    const at = clock({ 2: () => listAndLand(r, "fail") });
    const out = await stopThenWait(harness, r, () => {}, at);
    expect(out.waiting.decision).toBe("block");
    expect(out.waiting.reason).toMatch(FAILS);
    expect(turnOf(r)).toBe("in-turn");
  });

  it("B1 control: a slow file listed and passed during its first read stays silent", async () => {
    const r = await unlisted(harness);
    const at = clock({ 2: () => listAndLand(r, "pass") });
    const out = await stopThenWait(harness, r, () => {}, at);
    expect(out).toEqual({ quick: {}, waiting: {} });
    expect(turnOf(r)).toBe("idle");
  });

  it("B1 control: a slow failure the agent was told before the turn ended does not block", async () => {
    const r = await repo(harness, { requireSlowSuite: true, slowWaitMs: 400 });
    landSlow(r, "fail");
    await harness.startTurn(r);
    r.store.meta.set(refinedMetaKey(r.worktreeId), "0");
    const out = await stopThenWait(harness, r, () =>
      r.store.meta.set(refinedMetaKey(r.worktreeId), "1"),
    );
    expect(out).toEqual({ quick: {}, waiting: {} });
    expect(turnOf(r)).toBe("idle");
  });

  it("B1 control: a slow file first failing at a later revision, never seen pending, is not owed", async () => {
    const r = await unlisted(harness);
    const out = await stopThenWait(harness, r, () => {
      r.apply();
      listAndLand(r, "fail", "2");
    });
    expect(out).toEqual({ quick: {}, waiting: {} });
    expect(turnOf(r)).toBe("idle");
  });

  it("S2: blocks on an owed file re-keyed and failed before its first read", async () => {
    const r = await repo(harness, { requireSlowSuite: true, slowWaitMs: 400 });
    const out = await stopThenWait(harness, r, () => {
      queueSlowAgain(r);
      landSlow(r, "fail", "slow2");
    });
    expect(out.quick).toEqual({});
    expect(out.waiting.decision).toBe("block");
    expect(out.waiting.reason).toMatch(/ran at revision 2: 1 check fails/);
    expect(turnOf(r)).toBe("in-turn");
  });

  it("S2 control: an owed file re-keyed and passed before its first read stays silent", async () => {
    const r = await repo(harness, { requireSlowSuite: true, slowWaitMs: 400 });
    const out = await stopThenWait(harness, r, () => {
      queueSlowAgain(r);
      landSlow(r, "pass", "slow2");
    });
    expect(out).toEqual({ quick: {}, waiting: {} });
    expect(turnOf(r)).toBe("idle");
  });

  it("S2: blocks once on an owed file re-keyed and failed between two polls", async () => {
    const r = await repo(harness, { requireSlowSuite: true, slowWaitMs: 2_000 });
    const owed = () => {
      landSlow(r, "pass");
      r.store.meta.set(refinedMetaKey(r.worktreeId), "0");
    };
    const at = clock({
      3: () => {
        queueSlowAgain(r);
        landSlow(r, "fail", "slow2");
        r.store.meta.set(refinedMetaKey(r.worktreeId), "2");
      },
    });
    const out = await stopThenWait(harness, r, owed, at);
    expect(out.waiting.decision).toBe("block");
    expect(out.waiting.reason).toMatch(/ran at revision 2: 1 check fails/);
    expect(turnOf(r)).toBe("in-turn");
  });
});
