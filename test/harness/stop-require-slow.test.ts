import { describe, expect, it } from "vitest";
import { readTurn } from "../../src/core/delivery/turn.js";
import { testFileId } from "../../src/core/keys/index.js";
import type { StopWaitHarness } from "../../src/core/slow/index.js";
import { DEFAULT_POLICY, type TestFileRef } from "../../src/core/types/index.js";
import { runHook } from "../../src/harness/claude-code/index.js";
import { runCodexHook } from "../../src/harness/codex/index.js";
import type { HookDeps } from "../../src/harness/shared/hook.js";
import { codexRecorded } from "./codex/helpers.js";
import { FILE, recorded, type SquealRepo, squealRepo } from "./helpers.js";
import { markStopWait } from "./stop-slow-helpers.js";

/*
 * Spec 004 D7 and D9 as amended 2026-10-12: with `stop.requireSlowSuite` on,
 * a main agent's 2 s Stop blocks at once while a slow file is not current, as
 * before, until its harness's waiting entry is known to run for its session;
 * then it ends the turn with them pending and leaves them to that entry
 * (`stop-slow-wait.test.ts`).
 * A subagent's SubagentStop still blocks at once while a slow file is not
 * current, naming it and `run --slow --wait`. Off, the default, slow files
 * never hold a Stop.
 */

const deps: HookDeps = { env: {}, ensureDaemon: async () => "alive" };
const SLOW_FILE: TestFileRef = { project: "", path: "test/e2e/slow.test.ts" };
const WAIT_MS = 1_000;

interface Harness {
  readonly name: StopWaitHarness;
  startTurn(r: SquealRepo): Promise<void>;
  stop(r: SquealRepo): Promise<{ readonly stdout: string }>;
}

const HARNESSES: readonly Harness[] = [
  {
    name: "claude-code",
    async startTurn(r) {
      await runHook("session-start", recorded("session-start", r.root), deps);
      await runHook("user-prompt-submit", recorded("user-prompt-submit", r.root), deps);
    },
    stop: (r) => runHook("stop", recorded("stop", r.root), deps),
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
    stop: (r) => runCodexHook("stop", codexRecorded("exec", "stop", r.root), deps),
  },
];

/**
 * `include` marks slow files; the agent is in a turn; revision 1, its edit
 * after it registered, passes `math > adds`. `edited` false: revision 1
 * came before the registration, so the session changed nothing (004-67).
 */
async function repo(harness: Harness, include: readonly string[], require: boolean, edited = true) {
  const r = squealRepo();
  if (!edited) r.apply(r.pass());
  r.policy({
    slow: { ...DEFAULT_POLICY.slow, include },
    stop: { waitMs: WAIT_MS, requireSlowSuite: require },
  });
  await harness.startTurn(r);
  if (edited) r.apply(r.pass());
  return r;
}

function slowKey(r: SquealRepo, pending: "queued" | null): void {
  const revision = r.store.revisions.latest(r.worktreeId)?.number ?? 0;
  r.store.testFileKeys.upsertMany([
    { worktreeId: r.worktreeId, testFile: SLOW_FILE, key: "slow1", revision, pending },
  ]);
}

function decision(stdout: string): { decision?: string; reason?: string } {
  return stdout.trim() === "" ? {} : (JSON.parse(stdout) as { decision?: string });
}

describe.each(HARNESSES)("stop.requireSlowSuite, $name (spec 004 D7)", (harness) => {
  it.each<"queued" | null>(["queued", null])(
    "on, no waiting entry known to run here: blocks at once while a slow file is not current (%s)",
    async (pending) => {
      const r = await repo(harness, [SLOW_FILE.path], true);
      slowKey(r, pending);
      const started = performance.now();
      const out = decision((await harness.stop(r)).stdout);
      expect(performance.now() - started).toBeLessThan(WAIT_MS / 2);
      expect(out.decision).toBe("block");
      expect(out.reason).toMatch(
        /^Squeal policy stop.requireSlowSuite is on and 1 slow test file is not current at revision 1: test\/e2e\/slow.test.ts. `.*squeal.* run --slow --wait` runs them and waits for their results.\n\n/,
      );
    },
  );

  /*
   * Task 004-67: before the waiting entry is known to run, as for a Codex
   * user who has not trusted it yet, a session that changed nothing is not
   * held either.
   */
  it("on, no waiting entry known to run here: a session with no revision since it registered ends the turn", async () => {
    const r = await repo(harness, [SLOW_FILE.path], true, false);
    slowKey(r, "queued");
    expect(decision((await harness.stop(r)).stdout)).toEqual({});
    const [record] = r.store.consumers.list(r.worktreeId);
    expect(record && readTurn(r.store, record.consumer).turn).toBe("idle");
  });

  it("on, the waiting entry known to run here: ends the turn at once with the slow file pending, for it", async () => {
    const r = await repo(harness, [SLOW_FILE.path], true);
    markStopWait(r, harness.name);
    slowKey(r, "queued");
    const started = performance.now();
    expect(decision((await harness.stop(r)).stdout)).toEqual({});
    expect(performance.now() - started).toBeLessThan(WAIT_MS / 2);
    const [record] = r.store.consumers.list(r.worktreeId);
    expect(record && readTurn(r.store, record.consumer)).toMatchObject({
      turn: "idle",
      testFiles: [testFileId(SLOW_FILE)],
    });
  });

  it("on: lets the Stop end when every slow file is current", async () => {
    const r = await repo(harness, [FILE.path], true);
    expect(decision((await harness.stop(r)).stdout).decision).toBeUndefined();
  });

  it("off: a slow file not current never holds the Stop", async () => {
    const r = await repo(harness, [SLOW_FILE.path], false);
    slowKey(r, "queued");
    expect(decision((await harness.stop(r)).stdout).decision).toBeUndefined();
  });
});

describe("stop.requireSlowSuite at a SubagentStop, claude-code (spec 004 D7)", () => {
  const subagentStop = (r: SquealRepo, overrides: object = {}) =>
    runHook("stop", recorded("subagent-stop", r.root, overrides), deps);

  async function subagent(pending: "queued" | null) {
    const [harness] = HARNESSES;
    if (harness === undefined) throw new Error("no harness");
    const r = await repo(harness, [SLOW_FILE.path], true);
    await runHook("session-start", recorded("subagent-start", r.root), deps);
    slowKey(r, pending);
    return r;
  }

  it.each<"queued" | null>(["queued", null])(
    "blocks at once while a slow file is not current (%s), naming it and run --slow --wait",
    async (pending) => {
      const r = await subagent(pending);
      const started = performance.now();
      const out = decision((await subagentStop(r)).stdout);
      expect(performance.now() - started).toBeLessThan(WAIT_MS / 2);
      expect(out.decision).toBe("block");
      expect(out.reason).toMatch(
        /^Squeal policy stop.requireSlowSuite is on and 1 slow test file is not current at revision 1: test\/e2e\/slow.test.ts. `.*squeal.* run --slow --wait` runs them and waits for their results.\n\n/,
      );
    },
  );

  it("blocks a subagent that changed nothing too: 004-67 exempts only the main agent", async () => {
    const [harness] = HARNESSES;
    if (harness === undefined) throw new Error("no harness");
    const r = await repo(harness, [SLOW_FILE.path], true, false);
    slowKey(r, "queued");
    await runHook("session-start", recorded("subagent-start", r.root), deps);
    expect(decision((await subagentStop(r)).stdout).decision).toBe("block");
  });

  it("never blocks again while an earlier block keeps the agent going (stop_hook_active)", async () => {
    const r = await subagent("queued");
    expect(decision((await subagentStop(r)).stdout).decision).toBe("block");
    const again = await subagentStop(r, { stop_hook_active: true });
    expect(decision(again.stdout).decision).toBeUndefined();
  });
});
