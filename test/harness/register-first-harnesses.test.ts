import { describe, expect, it } from "vitest";
import { runHook } from "../../src/harness/claude-code/hooks.js";
import { bridgeDeps, register } from "../../src/harness/opencode/bridge.js";
import { startRun } from "../../src/harness/pi/run.js";
import { startSession } from "../../src/harness/pi/session.js";
import { workerDeps } from "../../src/harness/pi/worker.js";
import type { HookDeps } from "../../src/harness/shared/hook.js";
import { recorded, SESSION, type SquealRepo, squealRepo } from "./helpers.js";

/*
 * Row 005-98 in every harness that registers and may have to start a daemon: the registration
 * comes first, so the daemon's start, which a 2 s deadline can cut (Claude Code's and Codex's
 * hook timeout, OpenCode's bridge deadline, Pi's worker deadline), never comes before it.
 * SessionStart's own cases are in `register-first.test.ts`.
 */

const STARTING = "A daemon is starting";

/** No daemon, so the hook has to start one; `atSpawn` records whether it had registered. */
function noDaemon(): {
  r: SquealRepo;
  atSpawn: boolean[];
  ensureDaemon: NonNullable<HookDeps["ensureDaemon"]>;
} {
  const r = squealRepo();
  r.apply(r.pass());
  r.daemon("none");
  const atSpawn: boolean[] = [];
  const ensureDaemon = async () => {
    atSpawn.push(r.store.consumers.get(r.consumer()) !== null);
    return "spawned" as const;
  };
  return { r, atSpawn, ensureDaemon };
}

describe("a registration that has to start a daemon (row 005-98)", () => {
  it("in an interactive Claude Code prompt (the shared prompt path), registers first", async () => {
    const { r, atSpawn, ensureDaemon } = noDaemon();
    const out = await runHook("user-prompt-submit", recorded("user-prompt-submit", r.root), {
      env: { CLAUDE_CODE_SESSION_ATTENDED: "1" },
      cli: "/plugin/dist/cli/squeal.mjs",
      ensureDaemon,
    });
    expect(atSpawn).toEqual([true]);
    expect(out.stdout).toContain(STARTING);
  });

  it("in OpenCode's bridge, registers first", async () => {
    const { r, atSpawn, ensureDaemon } = noDaemon();
    const deps: HookDeps = {
      ...bridgeDeps(new URL("file:///pkg/dist/hooks/register.mjs"), { worktree: "/", pid: 1 }),
      env: {},
      ensureDaemon,
    };
    const answer = await register(
      { kind: "register", consumer: { sessionId: SESSION }, worktree: r.root, pid: process.pid },
      deps,
    );
    expect(atSpawn).toEqual([true]);
    expect(answer.header).toContain(STARTING);
  });

  it("in Pi's session start, registers first", async () => {
    const { r, atSpawn, ensureDaemon } = noDaemon();
    const deps: HookDeps = {
      ...workerDeps(new URL("file:///pkg/dist/worker.mjs")),
      env: {},
      ensureDaemon,
    };
    const text = await startSession({ sessionId: SESSION, cwd: r.root, reason: "resume" }, deps);
    expect(atSpawn).toEqual([true]);
    expect(text).toContain(STARTING);
  });

  it("in Pi's run start, registers first", async () => {
    const { r, atSpawn, ensureDaemon } = noDaemon();
    const deps: HookDeps = {
      ...workerDeps(new URL("file:///pkg/dist/worker.mjs")),
      env: {},
      ensureDaemon,
    };
    const answer = await startRun({ sessionId: SESSION, cwd: r.root }, deps);
    expect(atSpawn).toEqual([true]);
    expect(answer.news).toContain(STARTING);
  });
});
