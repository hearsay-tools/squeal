import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { storePaths } from "../../src/core/store/index.js";
import { type Consumer, MAIN_AGENT } from "../../src/core/types/index.js";
import {
  type HookDeps,
  type HookResult,
  runHook,
  waiterLockPath,
} from "../../src/harness/claude-code/index.js";
import { acquireWaiterLock } from "../../src/harness/claude-code/waiter-lock.js";
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
