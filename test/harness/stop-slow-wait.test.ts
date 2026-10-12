import { describe, expect, it } from "vitest";
import { readTurn } from "../../src/core/delivery/turn.js";
import { DEFAULT_POLICY, type PolicyFile, type TestFileRef } from "../../src/core/types/index.js";
import { runHook } from "../../src/harness/claude-code/index.js";
import { runCodexHook } from "../../src/harness/codex/index.js";
import type { HookDeps } from "../../src/harness/shared/hook.js";
import { STOP_SLOW_HANDOFF_MS } from "../../src/harness/shared/stop-slow.js";
import { check, result } from "../state/helpers.js";
import { codexRecorded } from "./codex/helpers.js";
import { recorded, type SquealRepo, squealRepo } from "./helpers.js";

/*
 * Spec 004 D9 as amended 2026-10-12: with `stop.requireSlowSuite` on, the
 * waiting Stop entry (`stop-slow`), run beside the 2 s one as both harnesses
 * run a Stop's entries, waits for the slow files not current up to
 * `stop.slowWaitMs`: silent when they pass, one block on a slow failure, one
 * block at the bound naming the files and `run --slow --wait`. Off, with
 * `stop_hook_active`, or after the 2 s entry spoke, it says nothing.
 */

const deps: HookDeps = { env: {}, ensureDaemon: async () => "alive", pollIntervalMs: 20 };
const SLOW_FILE: TestFileRef = { project: "", path: "test/e2e/slow.test.ts" };
const POSTS = check("ledger > posts", SLOW_FILE);

interface Out {
  readonly stdout: string;
}

interface Harness {
  readonly name: string;
  startTurn(r: SquealRepo): Promise<void>;
  stop(r: SquealRepo, overrides?: object): Promise<Out>;
  stopSlow(r: SquealRepo, overrides?: object): Promise<Out>;
}

const HARNESSES: readonly Harness[] = [
  {
    name: "claude-code",
    async startTurn(r) {
      await runHook("session-start", recorded("session-start", r.root), deps);
      await runHook("user-prompt-submit", recorded("user-prompt-submit", r.root), deps);
    },
    stop: (r, o) => runHook("stop", recorded("stop", r.root, o), deps),
    stopSlow: (r, o) => runHook("stop-slow", recorded("stop", r.root, o), deps),
  },
  {
    name: "codex",
    async startTurn(r) {
      await runCodexHook("session-start", codexRecorded("exec", "session-start", r.root), deps);
      await runCodexHook(
        "user-prompt-submit",
        codexRecorded("exec", "user-prompt-submit", r.root),
        deps,
      );
    },
    stop: (r, o) => runCodexHook("stop", codexRecorded("exec", "stop", r.root, o), deps),
    stopSlow: (r, o) => runCodexHook("stop-slow", codexRecorded("exec", "stop", r.root, o), deps),
  },
];

/** `math > adds` passes, the slow file is queued at revision 1, the agent is in a turn. */
async function repo(harness: Harness, stop: PolicyFile["stop"]): Promise<SquealRepo> {
  const r = squealRepo();
  r.apply(r.pass());
  r.policy({ slow: { ...DEFAULT_POLICY.slow, include: [SLOW_FILE.path] }, stop });
  slowKey(r, "queued");
  await harness.startTurn(r);
  return r;
}

function slowKey(r: SquealRepo, pending: "queued" | null): void {
  const revision = r.store.revisions.latest(r.worktreeId)?.number ?? 0;
  r.store.testFileKeys.upsertMany([
    { worktreeId: r.worktreeId, testFile: SLOW_FILE, key: "slow1", revision, pending },
  ]);
}

/** The slow file's run lands at the current revision, as the daemon's slow tier stores it. */
function landSlow(r: SquealRepo, outcome: "pass" | "fail"): void {
  const revision = r.store.revisions.latest(r.worktreeId)?.number ?? 0;
  const ran = result(POSTS, outcome, { key: "slow1", worktreeId: r.worktreeId, revision });
  r.store.transaction(() => r.store.results.putMany([ran]));
  slowKey(r, null);
  r.sink.applyResults(r.worktreeId, revision, [ran], { checkpointId: null });
}

function decision(out: Out): { decision?: string; reason?: string } {
  return out.stdout.trim() === "" ? {} : (JSON.parse(out.stdout) as { decision?: string });
}

/** Both entries at once, as the harness runs them; `during` acts while they run. */
async function stopBoth(
  harness: Harness,
  r: SquealRepo,
  during: () => void = () => {},
  afterMs = 300,
) {
  const timer = setTimeout(during, afterMs);
  try {
    const started = performance.now();
    const [quick, waiting] = await Promise.all([harness.stop(r), harness.stopSlow(r)]);
    return { quick: decision(quick), waiting: decision(waiting), ms: performance.now() - started };
  } finally {
    clearTimeout(timer);
  }
}

/** The main agent's turn state; each harness names its session. */
function turnOf(r: SquealRepo) {
  const [record] = r.store.consumers.list(r.worktreeId);
  if (record === undefined) throw new Error("no consumer");
  return readTurn(r.store, record.consumer).turn;
}

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
