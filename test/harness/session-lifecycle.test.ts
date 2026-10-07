import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createDelivery } from "../../src/core/delivery/index.js";
import { storePaths } from "../../src/core/store/index.js";
import { type Consumer, MAIN_AGENT } from "../../src/core/types/index.js";
import { acquireWaiterLock } from "../../src/core/waiter-lock/index.js";
import type { HookContext } from "../../src/harness/claude-code/context.js";
import {
  type HookDeps,
  type HookResult,
  runHook,
  waiterLockPath,
} from "../../src/harness/claude-code/index.js";
import { unregisterSession } from "../../src/harness/claude-code/sweep.js";
import { recorded, SESSION, type SquealRepo, SUBAGENT, squealRepo } from "./helpers.js";

/*
 * Lessons, defect 5: one interactive `/exit` left its consumer registered,
 * which keeps the daemon from idling out for 12 h. SessionEnd unregisters for
 * every reason and with no daemon; a new SessionStart for a session id sweeps
 * whatever an earlier SessionEnd left behind.
 */

const SILENT: HookResult = { stdout: "", stderr: "", exitCode: 0 };
const OTHER_SESSION = "0c1d2e3f-0000-4000-8000-000000000000";

function deps(overrides: Partial<HookDeps> = {}): HookDeps {
  return { env: {}, ensureDaemon: async () => "alive", ...overrides };
}

/** Registers a consumer straight in the store, as an earlier hook would have. */
function registered(r: SquealRepo, consumer: Partial<Consumer> = {}): Consumer {
  const full: Consumer = {
    worktreeId: r.worktreeId,
    sessionId: SESSION,
    agentId: MAIN_AGENT,
    ...consumer,
  };
  r.store.consumers.register(full, 1);
  return full;
}

function sessionsIn(r: SquealRepo, worktreeId: string): string[] {
  return r.store.consumers
    .list(worktreeId)
    .map((c) => `${c.consumer.sessionId}/${c.consumer.agentId}`);
}

describe("SessionEnd (defect 5)", () => {
  it.each([
    "clear",
    "logout",
    "prompt_input_exit",
    "other",
    "bypass_permissions_disabled",
    "a-reason-not-known-yet",
  ])("unregisters the session for reason %s", async (reason) => {
    const r = squealRepo();
    registered(r);
    registered(r, { agentId: SUBAGENT });

    const out = await runHook("session-end", recorded("session-end", r.root, { reason }), deps());

    expect(out).toEqual(SILENT);
    expect(sessionsIn(r, r.worktreeId)).toEqual([]);
  });

  it("unregisters without a daemon and never tries to start one", async () => {
    const r = squealRepo();
    r.daemon("none");
    registered(r);
    let ensured = 0;

    await runHook(
      "session-end",
      recorded("session-end", r.root),
      deps({
        ensureDaemon: async () => {
          ensured++;
          throw new Error("no daemon here");
        },
      }),
    );

    expect(sessionsIn(r, r.worktreeId)).toEqual([]);
    expect(ensured).toBe(0);
  });

  it("unregisters the session in every worktree of the store, wherever its cwd is now", async () => {
    const r = squealRepo();
    const other = r.repo.addWorktree("feature");
    r.store.worktrees.upsert({
      id: other.id,
      root: other.root,
      commonDir: r.repo.commonDir,
      isMain: false,
      registeredAt: 1,
      daemon: null,
    });
    registered(r);
    registered(r, { worktreeId: other.id, agentId: SUBAGENT });
    registered(r, { sessionId: OTHER_SESSION });

    // The session started in the main worktree; the agent has since moved into the other one.
    await runHook("session-end", recorded("session-end", other.root), deps());

    expect(sessionsIn(r, r.worktreeId)).toEqual([`${OTHER_SESSION}/main`]);
    expect(sessionsIn(r, other.id)).toEqual([]);
  });

  it("finds the store through CLAUDE_PROJECT_DIR when its cwd is outside any worktree", async () => {
    const r = squealRepo();
    registered(r);
    const outside = realpathSync(mkdtempSync(join(tmpdir(), "squeal-outside-")));

    await runHook(
      "session-end",
      recorded("session-end", outside),
      deps({ env: { CLAUDE_PROJECT_DIR: r.root } }),
    );

    expect(sessionsIn(r, r.worktreeId)).toEqual([]);
  });

  it("unregisters a consumer whose waiter still holds its lock, and keeps that lock", async () => {
    const r = squealRepo();
    const main = registered(r);
    const { locksDir } = storePaths(r.repo.commonDir);
    const lock = acquireWaiterLock(locksDir, main);
    expect(lock).not.toBeNull();

    await runHook("session-end", recorded("session-end", r.root), deps());

    expect(sessionsIn(r, r.worktreeId)).toEqual([]);
    const { existsSync } = await import("node:fs");
    expect(existsSync(waiterLockPath(locksDir, main))).toBe(true);
    lock?.release(true);
  });
});

describe("SessionStart sweep (defect 5)", () => {
  it("unregisters every consumer of the session id before registering its main agent", async () => {
    const r = squealRepo();
    r.apply(r.pass());
    const other = r.repo.addWorktree("feature");
    r.store.worktrees.upsert({
      id: other.id,
      root: other.root,
      commonDir: r.repo.commonDir,
      isMain: false,
      registeredAt: 1,
      daemon: null,
    });
    registered(r);
    registered(r, { agentId: SUBAGENT });
    registered(r, { worktreeId: other.id });
    registered(r, { sessionId: OTHER_SESSION });

    await runHook("session-start", recorded("session-start", r.root), deps({ now: () => 5_000 }));

    expect(sessionsIn(r, r.worktreeId)).toEqual([`${OTHER_SESSION}/main`, `${SESSION}/main`]);
    expect(sessionsIn(r, other.id)).toEqual([]);
    expect(r.store.consumers.get(r.consumer())?.registeredAt).toBe(5_000);
  });

  it("leaves the session's other consumers alone on SubagentStart", async () => {
    const r = squealRepo();
    r.apply(r.pass());
    registered(r);

    await runHook("session-start", recorded("subagent-start", r.root), deps());

    expect(sessionsIn(r, r.worktreeId)).toEqual(
      [`${SESSION}/${SUBAGENT}`, `${SESSION}/main`].sort(),
    );
  });
});

/*
 * Review wave 4.5, S4: SessionStart fires for `startup`, `resume`, `clear` and
 * `compact`. After a compaction the same session goes on, with its subagents
 * possibly still running, so only `startup` and `resume` mean an earlier run
 * of the session id is gone.
 */
describe("SessionStart sweep by source (review wave 4.5, S4)", () => {
  it.each(["startup", "resume"])("sweeps the session's subagents on %s", async (source) => {
    const r = squealRepo();
    r.apply(r.pass());
    registered(r);
    registered(r, { agentId: SUBAGENT });

    await runHook("session-start", recorded("session-start", r.root, { source }), deps());

    expect(sessionsIn(r, r.worktreeId)).toEqual([`${SESSION}/main`]);
  });

  it("keeps a live subagent and the main agent's view on compact", async () => {
    const r = squealRepo();
    r.apply(r.pass());
    await runHook("session-start", recorded("session-start", r.root), deps());
    await runHook("session-start", recorded("subagent-start", r.root), deps());
    // A regression the main agent has not been told yet.
    r.apply(r.fail());

    const out = await runHook(
      "session-start",
      recorded("session-start", r.root, { source: "compact" }),
      deps(),
    );

    expect(out).toEqual(SILENT);
    expect(sessionsIn(r, r.worktreeId)).toEqual(
      [`${SESSION}/${SUBAGENT}`, `${SESSION}/main`].sort(),
    );
    // Not re-seeded: the regression is still delivered at the next tool boundary.
    const next = await runHook("post-tool-batch", recorded("post-tool-batch", r.root), deps());
    expect(next.stdout).toContain("PASS -> FAIL");
  });

  it("registers the main agent on compact when it is not registered", async () => {
    const r = squealRepo();
    r.apply(r.pass());

    await runHook(
      "session-start",
      recorded("session-start", r.root, { source: "compact" }),
      deps(),
    );

    expect(sessionsIn(r, r.worktreeId)).toEqual([`${SESSION}/main`]);
  });

  it.each(["clear", undefined])("does not sweep on source %s", async (source) => {
    const r = squealRepo();
    r.apply(r.pass());
    registered(r, { agentId: SUBAGENT });

    await runHook("session-start", recorded("session-start", r.root, { source }), deps());

    expect(sessionsIn(r, r.worktreeId)).toEqual(
      [`${SESSION}/${SUBAGENT}`, `${SESSION}/main`].sort(),
    );
  });
});

describe("unregisterSession errors (review wave 4.5, N8)", () => {
  function contextWith(r: SquealRepo, failing: (consumer: Consumer) => Error | null): HookContext {
    const delivery = createDelivery(r.store, {
      status: {
        build: () => ({ schemaVersion: 1, available: false, reason: "timeout", message: "" }),
      },
    });
    return {
      root: r.root,
      commonDir: r.repo.commonDir,
      store: r.store,
      consumer: r.consumer(),
      delivery: {
        ...delivery,
        unregister: async (consumer) => {
          const error = failing(consumer);
          if (error !== null) throw error;
          await delivery.unregister(consumer);
        },
      },
      close: () => {},
    };
  }

  it("tries every consumer and throws every error as one AggregateError", async () => {
    const r = squealRepo();
    registered(r);
    registered(r, { agentId: SUBAGENT });
    registered(r, { agentId: "agent-3" });
    const context = contextWith(r, (consumer) =>
      consumer.agentId === MAIN_AGENT ? null : new Error(`locked: ${consumer.agentId}`),
    );

    const thrown = await unregisterSession(context, SESSION, { removeLocks: false }).catch(
      (error: unknown) => error,
    );

    expect(thrown).toBeInstanceOf(AggregateError);
    expect((thrown as AggregateError).errors.map((e: Error) => e.message).sort()).toEqual(
      [`locked: ${SUBAGENT}`, "locked: agent-3"].sort(),
    );
    expect((thrown as AggregateError).message).toBe(
      `squeal: 2 errors unregistering session ${SESSION}`,
    );
    expect(sessionsIn(r, r.worktreeId).sort()).toEqual(
      [`${SESSION}/${SUBAGENT}`, `${SESSION}/agent-3`].sort(),
    );
  });

  it("throws a single error as it is", async () => {
    const r = squealRepo();
    registered(r, { agentId: SUBAGENT });
    const error = new Error("locked");
    const context = contextWith(r, () => error);

    await expect(unregisterSession(context, SESSION, { removeLocks: false })).rejects.toBe(error);
  });
});
