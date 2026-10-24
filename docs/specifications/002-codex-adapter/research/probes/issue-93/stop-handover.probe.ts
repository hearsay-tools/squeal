import { describe, expect, it } from "vitest";
import { claimHandoff, handoffFrom } from "../../../../../../src/core/delivery/handoff.js";
import { appendNote } from "../../../../../../src/core/notes.js";
import { type DaemonRecord, daemonExitMetaKey } from "../../../../../../src/core/types/index.js";
import { runCodexHook } from "../../../../../../src/harness/codex/index.js";
import type { HookDeps } from "../../../../../../src/harness/shared/hook.js";
import { SUBTRACTS, type SquealRepo, squealRepo } from "../../../../../../test/harness/helpers.js";
import { codexRecorded, sessionOf } from "../../../../../../test/harness/codex/helpers.js";

/*
 * Throwaway probe for gh-93. Synthetic: a fixture store and the Codex Stop
 * handler in process, no live Codex, no daemon process. Every Stop gate off,
 * no known failure, nothing pending; the only change since the last tool
 * boundary is that the daemon began handing over.
 */

const deps: HookDeps = { env: {}, ensureDaemon: async () => "alive" };
const IN_SESSION = sessionOf("exec", "session-start");
const hook = (r: SquealRepo, name: "session-start" | "user-prompt-submit" | "post-tool-use" | "stop", fixture: string, overrides: object = {}) =>
  runCodexHook(name, codexRecorded("exec", fixture, r.root, overrides), deps);

const ALL_OFF = {
  stop: { blockOnKnownFailures: false, requireFullSuite: false, requireSlowSuite: false, waitMs: 0 },
};

function liveDaemon(r: SquealRepo): DaemonRecord {
  const record: DaemonRecord = {
    socketPath: `/tmp/squeal-probe-${r.worktreeId}.sock`,
    startedAt: Date.now() - 600_000,
    heartbeatAt: Date.now(),
    heartbeatIntervalMs: 3_600_000,
    squealVersion: "0.1.295",
    token: "old",
  };
  r.store.worktrees.setDaemon(r.worktreeId, record);
  return record;
}

/** Registered, all checks passing, in a turn, the live daemon already told at a tool boundary. */
async function quietTurn(): Promise<{ r: SquealRepo; record: DaemonRecord }> {
  const r = squealRepo();
  r.policy(ALL_OFF);
  const record = liveDaemon(r);
  r.apply(r.pass(), r.pass(SUBTRACTS));
  await hook(r, "session-start", "session-start");
  await hook(r, "user-prompt-submit", "user-prompt-submit");
  await hook(r, "post-tool-use", "post-tool-use");
  return { r, record };
}

/**
 * The daemon's shutdown began with a handoff claim to 0.1.296, as a step-down
 * leaves it. `stale`: its heartbeat stopped with its timers at `since`, as
 * `#shutdown` leaves it (test/status/stopping.test.ts, heartbeat "down").
 */
function handingOver(r: SquealRepo, record: DaemonRecord, stale: boolean): void {
  const self = handoffFrom(record);
  const since = Date.now() - 2_000;
  if (stale) r.store.worktrees.setDaemon(r.worktreeId, { ...record, heartbeatAt: since, heartbeatIntervalMs: 500 });
  r.store.meta.set(daemonExitMetaKey(r.worktreeId), self);
  appendNote(r.store, r.worktreeId, { at: since, revision: 1, text: "daemon stepped down", exitOf: self });
  claimHandoff(r.store, r.worktreeId, { from: self, to: "0.1.296", at: since });
}

describe("gh-93: Codex Stop with every gate off", () => {
  it("control: no change since the last boundary, Stop is silent", async () => {
    const { r } = await quietTurn();
    const out = await hook(r, "stop", "stop");
    console.log("CONTROL stdout:", JSON.stringify(out.stdout));
    expect(out.stdout).toBe("");
  });

  it("handover begun, old heartbeat still fresh: Stop is silent", async () => {
    const { r, record } = await quietTurn();
    handingOver(r, record, false);
    const out = await hook(r, "stop", "stop");
    console.log("HANDOVER (fresh heartbeat) stdout:", JSON.stringify(out.stdout));
    expect(out.stdout).toBe("");
  });

  it("handover, old heartbeat stopped: Stop answers decision block with status text", async () => {
    const { r, record } = await quietTurn();
    handingOver(r, record, true);
    const out = await hook(r, "stop", "stop");
    console.log("HANDOVER stdout:", out.stdout);
    const parsed = JSON.parse(out.stdout) as { decision?: string; reason?: string };
    expect(parsed.decision).toBe("block");
    expect(parsed.reason).toMatch(/handing over/);
    expect(parsed.reason).toMatch(/Known failures: 0/);

    const again = await hook(r, "stop", "stop-hook-active", IN_SESSION);
    console.log("SECOND STOP (stop_hook_active) stdout:", JSON.stringify(again.stdout));
    expect(again.stdout).toBe("");
  });
});
