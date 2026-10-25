import { describe, expect, it } from "vitest";
import {
  claimHandoff,
  endHandoff,
  HANDOFF_BOUND_MS,
  handoffFrom,
} from "../../src/core/delivery/handoff.js";
import { appendNote } from "../../src/core/notes.js";
import { mergeHoldMetaKey } from "../../src/core/scheduler/hold-rows.js";
import { type DaemonRecord, daemonExitMetaKey, type EpochMs } from "../../src/core/types/index.js";
import { runHook } from "../../src/harness/claude-code/index.js";
import { runCodexHook } from "../../src/harness/codex/index.js";
import type { HookDeps } from "../../src/harness/shared/hook.js";
import { codexRecorded } from "./codex/helpers.js";
import { recorded, type SquealRepo, SUBTRACTS, squealRepo } from "./helpers.js";

/*
 * Row 011-215 (gh-93; 002 D3 and 011 C8 as amended 2026-10-25): at Stop, a
 * liveness change that names no action is not news, so with every gate off a
 * handover alone lets the turn end; the next tool boundary tells it. A daemon
 * down with no successor, an overdue handoff, a short handoff and a gate the
 * Stop cannot meet still speak. Both adapters, from their recorded inputs.
 */

const OLD = "0.1.295";
const NEXT = "0.1.296";
const deps: HookDeps = { env: {}, squealVersion: OLD, ensureDaemon: async () => "alive" };
const ALL_OFF = {
  stop: {
    blockOnKnownFailures: false,
    requireFullSuite: false,
    requireSlowSuite: false,
    waitMs: 0,
  },
};

type Hook = "session-start" | "user-prompt-submit" | "boundary" | "stop";

/** What either adapter's hook printed. */
interface HookResult {
  readonly stdout: string;
}

interface Adapter {
  readonly run: (r: SquealRepo, hook: Hook) => Promise<HookResult>;
  /** How a Stop that speaks without a block says it: Claude Code's context, Codex's block. */
  readonly news: "context" | "block";
}

const ADAPTERS: Record<"claude-code" | "codex", Adapter> = {
  "claude-code": {
    run: (r, hook) => {
      const name = hook === "boundary" ? "post-tool-batch" : hook;
      return runHook(name, recorded(name, r.root), deps);
    },
    news: "context",
  },
  codex: {
    run: (r, hook) => {
      const name = hook === "boundary" ? "post-tool-use" : hook;
      return runCodexHook(name, codexRecorded("exec", name, r.root), deps);
    },
    news: "block",
  },
};

/** What a hook said: a block's reason, or its context; `null` for silence. */
function said(out: HookResult): { block: boolean; text: string } | null {
  if (out.stdout === "") return null;
  const parsed = JSON.parse(out.stdout) as {
    decision?: string;
    reason?: string;
    hookSpecificOutput?: { additionalContext?: string };
  };
  if (parsed.decision === "block") return { block: true, text: parsed.reason ?? "" };
  return { block: false, text: parsed.hookSpecificOutput?.additionalContext ?? "" };
}

function liveDaemon(r: SquealRepo): DaemonRecord {
  const record: DaemonRecord = {
    socketPath: `/tmp/squeal-test-${r.worktreeId}.sock`,
    startedAt: (Date.now() - 600_000) as EpochMs,
    heartbeatAt: Date.now() as EpochMs,
    heartbeatIntervalMs: 3_600_000,
    squealVersion: OLD,
    token: "old",
  };
  r.store.worktrees.setDaemon(r.worktreeId, record);
  return record;
}

/** Registered, every check passing, in a turn, the live daemon told at a tool boundary. */
async function quietTurn(
  adapter: Adapter,
  policy: object = ALL_OFF,
): Promise<{ r: SquealRepo; record: DaemonRecord }> {
  const r = squealRepo();
  r.policy(policy);
  const record = liveDaemon(r);
  r.apply(r.pass(), r.pass(SUBTRACTS));
  await adapter.run(r, "session-start");
  await adapter.run(r, "user-prompt-submit");
  await adapter.run(r, "boundary");
  return { r, record };
}

/**
 * The daemon's shutdown began `ago` ms ago with a claim to `NEXT`, as a
 * step-down leaves it, and its heartbeat stopped with its timers then.
 */
function handingOver(r: SquealRepo, record: DaemonRecord, ago = 2_000): void {
  const self = handoffFrom(record);
  const since = (Date.now() - ago) as EpochMs;
  r.store.worktrees.setDaemon(r.worktreeId, {
    ...record,
    heartbeatAt: since,
    heartbeatIntervalMs: 500,
  });
  r.store.meta.set(daemonExitMetaKey(r.worktreeId), self);
  appendNote(r.store, r.worktreeId, {
    at: since,
    revision: 1,
    text: "daemon stepped down",
    exitOf: self,
  });
  claimHandoff(r.store, r.worktreeId, { from: self, to: NEXT, at: since });
}

describe.each(Object.entries(ADAPTERS))(
  "%s Stop with every gate off (row 011-215)",
  (_, adapter) => {
    it("is silent when a handover is its only news", async () => {
      const { r, record } = await quietTurn(adapter);
      handingOver(r, record);
      expect(await adapter.run(r, "stop")).toMatchObject({ stdout: "" });
    });

    it("leaves the handover to the next tool boundary, which tells it once", async () => {
      const { r, record } = await quietTurn(adapter);
      handingOver(r, record);
      await adapter.run(r, "stop");
      const next = said(await adapter.run(r, "boundary"));
      expect(next?.text).toMatch(/^SQUEAL · the daemon is handing over at revision 1\n/);
      expect(next?.text).toContain(`${NEXT} serves once the old daemon's lock frees`);
      expect(await adapter.run(r, "boundary")).toMatchObject({ stdout: "" });
    });

    it("still speaks for a daemon down with no successor", async () => {
      const { r } = await quietTurn(adapter);
      r.daemon("stale", Date.now() - 60_000);
      const stop = said(await adapter.run(r, "stop"));
      expect(stop).toMatchObject({ block: adapter.news === "block" });
      expect(stop?.text).toMatch(/^SQUEAL · no daemon is validating at revision 1\n/);
    });

    it("still speaks for a handoff past its bound, naming `squeal start`", async () => {
      const { r, record } = await quietTurn(adapter);
      handingOver(r, record, HANDOFF_BOUND_MS + 2_000);
      const stop = said(await adapter.run(r, "stop"));
      expect(stop).toMatchObject({ block: adapter.news === "block" });
      expect(stop?.text).toMatch(/^SQUEAL · the daemon is handing over at revision 1\n/);
      expect(stop?.text).toContain("past its 130 s bound; `squeal start` finishes it");
    });

    it("still speaks for a handoff that ended short (row 011-140)", async () => {
      const { r, record } = await quietTurn(adapter);
      claimHandoff(r.store, r.worktreeId, {
        from: "0.1.294@1#t",
        to: NEXT,
        at: Date.now() as EpochMs,
      });
      endHandoff(r.store, r.worktreeId, {
        of: handoffFrom(record),
        version: OLD,
        executable: "/data/versions/0.1.296/dist/cli/squeal.mjs",
        at: Date.now() as EpochMs,
      });
      const stop = said(await adapter.run(r, "stop"));
      expect(stop).toMatchObject({ block: adapter.news === "block" });
      expect(stop?.text).toMatch(
        /^SQUEAL · a 0\.1\.295 daemon is validating at revision 1, not 0\.1\.296\n/,
      );
    });

    it("leaves a hold's start to the next tool boundary", async () => {
      const { r } = await quietTurn(adapter);
      const row = { v: 1, since: Date.now(), revision: 1, paths: ["src/math.ts"], count: 1 };
      r.store.meta.set(mergeHoldMetaKey(r.worktreeId), JSON.stringify(row));
      expect(await adapter.run(r, "stop")).toMatchObject({ stdout: "" });
      const next = said(await adapter.run(r, "boundary"));
      expect(next?.text).toMatch(
        /^SQUEAL · validation on hold at revision 1: git lists 1 unmerged path/,
      );
    });

    it("tells the handover beside a transition", async () => {
      const { r, record } = await quietTurn(adapter);
      r.apply(r.fail());
      handingOver(r, record);
      const stop = said(await adapter.run(r, "stop"));
      expect(stop?.text).toMatch(/^SQUEAL · 1 check changed/);
      expect(stop?.text).toContain(`${NEXT} serves once the old daemon's lock frees`);
      expect(said(await adapter.run(r, "boundary"))?.text ?? "").not.toContain("handing over");
    });
  },
);

describe.each(Object.entries(ADAPTERS))("%s Stop with a gate on (row 011-215)", (_, adapter) => {
  it("still blocks during a handover when the gate is not met", async () => {
    const policy = { stop: { requireFullSuite: true, waitMs: 0 } };
    const { r, record } = await quietTurn(adapter, policy);
    handingOver(r, record);
    const stop = said(await adapter.run(r, "stop"));
    expect(stop?.block).toBe(true);
    expect(stop?.text).toMatch(/^Squeal policy stop\.requireFullSuite is on/);
    expect(stop?.text).toContain(`${NEXT} serves once the old daemon's lock frees`);
  });
});
