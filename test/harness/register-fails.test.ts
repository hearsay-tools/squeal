import { describe, expect, it } from "vitest";
import { storePaths } from "../../src/core/store/paths.js";
import { runHook } from "../../src/harness/claude-code/hooks.js";
import { runCodexHook } from "../../src/harness/codex/hooks.js";
import { bridgeDeps, register } from "../../src/harness/opencode/bridge.js";
import { startRun } from "../../src/harness/pi/run.js";
import { startSession } from "../../src/harness/pi/session.js";
import type { HookDeps } from "../../src/harness/shared/hook.js";
import { threadLockHolder } from "../helpers/busy-store.js";
import { codexRecorded } from "./codex/helpers.js";
import { piDeps, recorded, SESSION, type SquealRepo, squealRepo } from "./helpers.js";

/*
 * Row 005-102: since 0.1.541 (row 005-98) a start registers first and ensures the daemon after.
 * A registration that throws (here a busy store: another connection holds the write lock past
 * the hook's busy timeout) must still start the daemon, as before 0.1.541, when the start came
 * first; else the daemon starts only at the first tool boundary, also in a repository with
 * `baseline.onStart` `lookup-then-run-missing`. The hook's exit and output stay as before: the
 * error is thrown, and Claude Code's and Codex's hooks end silent with exit 0.
 */

/** Longer than the hook's busy timeout (`STATUS_BUSY_TIMEOUT_MS`, 1 s). */
const HOLD_MS = 10_000;
const SILENT = { stdout: "", stderr: "", exitCode: 0 };
/** Codex's silent hook: no exit code, so 0. */
const CODEX_SILENT = { stdout: "", stderr: "" };

/** No daemon, the store's write lock held by another thread; `spawns` counts the daemon's starts. */
function busyNoDaemon(): {
  r: SquealRepo;
  spawns: () => number;
  ensureDaemon: NonNullable<HookDeps["ensureDaemon"]>;
} {
  const r = squealRepo();
  r.apply(r.pass());
  r.daemon("none");
  let spawns = 0;
  const ensureDaemon = async () => {
    spawns += 1;
    return "spawned" as const;
  };
  threadLockHolder(storePaths(r.repo.commonDir).database, HOLD_MS).take();
  return { r, spawns: () => spawns, ensureDaemon };
}

describe("a start whose registration fails still starts the daemon (row 005-102)", () => {
  it("in Claude Code's SessionStart, silent with exit 0", async () => {
    const { r, spawns, ensureDaemon } = busyNoDaemon();
    const out = await runHook("session-start", recorded("session-start", r.root), {
      env: {},
      cli: "/plugin/dist/cli/squeal.mjs",
      ensureDaemon,
    });
    expect(out).toEqual(SILENT);
    expect(spawns()).toBe(1);
    expect(r.store.consumers.get(r.consumer())).toBeNull();
  });

  it("in Codex's SessionStart, silent with exit 0", async () => {
    const { r, spawns, ensureDaemon } = busyNoDaemon();
    const out = await runCodexHook(
      "session-start",
      codexRecorded("exec", "session-start", r.root),
      {
        env: {},
        ensureDaemon,
      },
    );
    expect(out).toEqual(CODEX_SILENT);
    expect(spawns()).toBe(1);
  });

  it("in an interactive Claude Code prompt (the shared prompt path), silent with exit 0", async () => {
    const { r, spawns, ensureDaemon } = busyNoDaemon();
    const out = await runHook("user-prompt-submit", recorded("user-prompt-submit", r.root), {
      env: { CLAUDE_CODE_SESSION_ATTENDED: "1" },
      cli: "/plugin/dist/cli/squeal.mjs",
      ensureDaemon,
    });
    expect(out).toEqual(SILENT);
    expect(spawns()).toBe(1);
  });

  it("in OpenCode's bridge, which throws the registration's error", async () => {
    const { r, spawns, ensureDaemon } = busyNoDaemon();
    const deps: HookDeps = {
      ...bridgeDeps(new URL("file:///pkg/dist/hooks/register.mjs"), { worktree: "/", pid: 1 }),
      env: {},
      ensureDaemon,
    };
    const answer = register(
      { kind: "register", consumer: { sessionId: SESSION }, worktree: r.root, pid: process.pid },
      deps,
    );
    await expect(answer).rejects.toThrow(/locked/);
    expect(spawns()).toBe(1);
  });

  it("in Pi's session start, which throws the registration's error", async () => {
    const { r, spawns, ensureDaemon } = busyNoDaemon();
    const text = startSession(
      { sessionId: SESSION, cwd: r.root, reason: "resume" },
      piDeps({ ensureDaemon }),
    );
    await expect(text).rejects.toThrow(/locked/);
    expect(spawns()).toBe(1);
  });

  it("in Pi's run start, which throws the registration's error", async () => {
    const { r, spawns, ensureDaemon } = busyNoDaemon();
    const answer = startRun({ sessionId: SESSION, cwd: r.root }, piDeps({ ensureDaemon }));
    await expect(answer).rejects.toThrow(/locked/);
    expect(spawns()).toBe(1);
  });
});
