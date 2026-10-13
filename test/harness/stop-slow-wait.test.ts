import { describe, expect, it } from "vitest";
import { squealVersion } from "../../src/core/daemon/version.js";
import { recordStopWait, stopWaitRuns } from "../../src/core/slow/index.js";
import { runHook } from "../../src/harness/claude-code/index.js";
import { STOP_SLOW_HANDOFF_MS } from "../../src/harness/shared/stop-slow.js";
import { recorded } from "./helpers.js";
import {
  decision,
  deps,
  HARNESSES,
  landSlow,
  mainConsumer,
  repo,
  slowKey,
  stopBoth,
  turnOf,
} from "./stop-slow-helpers.js";

/*
 * Spec 004 D9 as amended 2026-10-12: with `stop.requireSlowSuite` on, the
 * waiting Stop entry (`stop-slow`), run beside the 2 s one as both harnesses
 * run a Stop's entries, waits for the slow files not current up to
 * `stop.slowWaitMs`: silent when they pass, one block on a slow failure, one
 * block at the bound naming the files and `run --slow --wait`. Off, with
 * `stop_hook_active`, or after the 2 s entry spoke, it says nothing.
 */

const OTHER_SESSION = "0b9a7c1e-5d2f-4e8a-9c3b-1f6d2e7a8b90";

describe.each(HARNESSES)("Stop waits for its slow tier, $name (004 D9 as amended)", (harness) => {
  it("on: waits for a running slow file and ends the turn silently when it passes", async () => {
    const r = await repo(harness, { requireSlowSuite: true });
    const out = await stopBoth(harness, r, () => landSlow(r, "pass"));
    expect(out.quick).toEqual({});
    expect(out.waiting).toEqual({});
    expect(out.ms).toBeGreaterThanOrEqual(290);
    expect(turnOf(r)).toBe("idle");
  });

  it("on: blocks once on a slow failure, naming it, and takes the turn", async () => {
    const r = await repo(harness, { requireSlowSuite: true });
    const out = await stopBoth(harness, r, () => landSlow(r, "fail"));
    expect(out.quick).toEqual({});
    expect(out.waiting.decision).toBe("block");
    expect(out.waiting.reason).toMatch(
      /^Squeal policy stop.requireSlowSuite is on and the slow tier ran at revision 1: 1 check fails: test\/e2e\/slow.test.ts > ledger > posts\.\n\n/,
    );
    expect(out.waiting.reason).toContain("expected 1 to be 2");
    expect(turnOf(r)).toBe("in-turn");
  });

  it("on: blocks once at the bound, naming the file still running and run --slow --wait", async () => {
    const r = await repo(harness, { requireSlowSuite: true, slowWaitMs: 400 });
    const out = await stopBoth(harness, r);
    expect(out.quick).toEqual({});
    expect(out.waiting.decision).toBe("block");
    expect(out.waiting.reason).toMatch(
      /^Squeal policy stop.requireSlowSuite is on and after 0.4 s 1 slow test file is still not current at revision 1: test\/e2e\/slow.test.ts. `.*squeal.* run --slow --wait` waits for their results.\n\n/,
    );
    expect(out.ms).toBeGreaterThanOrEqual(400);
    expect(turnOf(r)).toBe("in-turn");
  });

  it("waits too for a slow file a later revision queues while it waits", async () => {
    const r = await repo(harness, { requireSlowSuite: true, slowWaitMs: 600 });
    const out = await stopBoth(harness, r, () => {
      landSlow(r, "pass");
      r.queue("k2");
    });
    expect(out.waiting.decision).toBe("block");
    expect(out.waiting.reason).toMatch(
      /^Squeal policy stop.requireSlowSuite is on and after 0.6 s 1 slow test file is still not current at revision 2: src\/math.test.ts\./,
    );
  });

  it("unmarked: the 2 s entry blocks at once as before, and the waiting entry stays silent and marks", async () => {
    const r = await repo(harness, { requireSlowSuite: true }, false);
    const quick = decision(await harness.stop(r));
    expect(quick.decision).toBe("block");
    expect(quick.reason).toMatch(
      /^Squeal policy stop.requireSlowSuite is on and 1 slow test file is not current at revision 1: test\/e2e\/slow.test.ts. `.*squeal.* run --slow --wait` runs them/,
    );
    const timer = setTimeout(() => landSlow(r, "fail"), 200);
    try {
      expect(decision(await harness.stopSlow(r))).toEqual({});
    } finally {
      clearTimeout(timer);
    }
    expect(stopWaitRuns(r.store, mainConsumer(r), harness.name, squealVersion())).toBe(true);
  });

  it("marked by another harness or version: the 2 s entry still blocks at once", async () => {
    const r = await repo(harness, { requireSlowSuite: true }, false);
    const other = harness.name === "codex" ? "claude-code" : "codex";
    recordStopWait(r.store, mainConsumer(r), other, squealVersion());
    recordStopWait(r.store, mainConsumer(r), harness.name, "0.0.1-older");
    expect(decision(await harness.stop(r)).decision).toBe("block");
  });

  it("another session in the worktree without the waiting entry keeps the old block (001-297)", async () => {
    const r = await repo(harness, { requireSlowSuite: true });
    const marked = mainConsumer(r);
    const other = { session_id: OTHER_SESSION, transcript_path: `/t/${OTHER_SESSION}.jsonl` };
    await harness.startTurn(r, other);
    const quick = decision(await harness.stop(r, other));
    expect(quick.decision).toBe("block");
    expect(quick.reason).toMatch(
      /^Squeal policy stop.requireSlowSuite is on and 1 slow test file is not current at revision 1: test\/e2e\/slow.test.ts\./,
    );
    expect(decision(await harness.stop(r))).toEqual({});
    const sessions = r.store.consumers.list(r.worktreeId).map((c) => c.consumer);
    const unmarked = sessions.find((c) => c.sessionId === OTHER_SESSION);
    expect(unmarked && stopWaitRuns(r.store, unmarked, harness.name, squealVersion())).toBe(false);
    expect(stopWaitRuns(r.store, marked, harness.name, squealVersion())).toBe(true);
  });

  it("off: returns at once without waiting, and the turn ends as today", async () => {
    const r = await repo(harness, { requireSlowSuite: false });
    const out = await stopBoth(harness, r);
    expect(out).toMatchObject({ quick: {}, waiting: {} });
    expect(out.ms).toBeLessThan(STOP_SLOW_HANDOFF_MS / 2);
    expect(turnOf(r)).toBe("idle");
  });

  it("never blocks a Stop with stop_hook_active, and returns at once", async () => {
    const r = await repo(harness, { requireSlowSuite: true });
    const started = performance.now();
    const out = await harness.stopSlow(r, { stop_hook_active: true });
    expect(out.stdout).toBe("");
    expect(performance.now() - started).toBeLessThan(STOP_SLOW_HANDOFF_MS / 2);
  });

  it("says nothing when the 2 s entry blocked: the two never both block", async () => {
    const r = await repo(harness, { requireSlowSuite: true, blockOnKnownFailures: true });
    r.apply(r.fail());
    slowKey(r, "queued");
    const out = await stopBoth(harness, r, () => landSlow(r, "fail"));
    expect(out.quick.decision).toBe("block");
    expect(out.quick.reason).toMatch(/^Squeal policy stop.blockOnKnownFailures is on/);
    expect(out.waiting).toEqual({});
  });

  it("says nothing when the turn starts again while it waits (a prompt or the waiter's wake)", async () => {
    const r = await repo(harness, { requireSlowSuite: true, slowWaitMs: 2_000 });
    const out = await stopBoth(harness, r, () => void harness.startTurn(r));
    expect(out.waiting).toEqual({});
    expect(out.ms).toBeLessThan(1_500);
  });

  it("decides after a 2 s entry that finished before it started", async () => {
    const r = await repo(harness, { requireSlowSuite: true });
    expect(decision(await harness.stop(r))).toEqual({});
    const timer = setTimeout(() => landSlow(r, "fail"), 200);
    try {
      expect(decision(await harness.stopSlow(r)).decision).toBe("block");
    } finally {
      clearTimeout(timer);
    }
  });
});

it("a SubagentStop never waits (claude-code)", async () => {
  const [harness] = HARNESSES;
  if (harness === undefined) throw new Error("no harness");
  const r = await repo(harness, { requireSlowSuite: true });
  await runHook("session-start", recorded("subagent-start", r.root), deps);
  const started = performance.now();
  const out = await runHook("stop-slow", recorded("subagent-stop", r.root), deps);
  expect(out.stdout).toBe("");
  expect(performance.now() - started).toBeLessThan(STOP_SLOW_HANDOFF_MS / 2);
});
