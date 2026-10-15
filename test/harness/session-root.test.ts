import { readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MAIN_AGENT } from "../../src/core/types/index.js";
import { type HookDeps, runHook } from "../../src/harness/claude-code/index.js";
import { runCodexHook } from "../../src/harness/codex/index.js";
import { bridgeDeps, register } from "../../src/harness/opencode/bridge.js";
import { after, before } from "../../src/harness/opencode/bridge-turn.js";
import { sessionRootFiles } from "../../src/harness/shared/session-root.js";
import { tempDir } from "../store/helpers.js";
import { codexInput, codexRecorded } from "./codex/helpers.js";
import { recorded, SESSION, SUBTRACTS, squealRepo } from "./helpers.js";

/*
 * Task 001-405 (cezar session 74366d0f's feedback, item 2; the human's
 * decision of 2026-10-15): every hook of a session uses the root its
 * SessionStart resolved, so a `cd` into a sibling worktree only to read its
 * `git status` starts no daemon there and changes no header.
 */

/** A repository whose session started in its main worktree, and a sibling worktree. */
function started() {
  const r = squealRepo();
  r.apply(r.pass());
  const other = r.repo.addWorktree("other");
  const runtime = tempDir("squeal-session-roots-");
  const ensured: string[] = [];
  const deps: HookDeps = {
    env: {},
    sessionRoots: sessionRootFiles({ XDG_RUNTIME_DIR: runtime }),
    ensureDaemon: async (root) => {
      ensured.push(root);
      return "alive";
    },
  };
  const consumerIn = (worktreeId: string) => ({
    worktreeId,
    sessionId: SESSION,
    agentId: MAIN_AGENT,
  });
  return { r, other, runtime, ensured, deps, consumerIn };
}

describe("Claude Code hooks stay on the session's root (task 001-405)", () => {
  it("a tool call whose cwd is another worktree starts nothing there and reports the session's own root", async () => {
    const { r, other, ensured, deps, consumerIn } = started();
    await runHook("session-start", recorded("session-start", r.root), deps);
    expect(ensured).toEqual([r.root]);

    // The session's own worktree regresses; the agent has `cd`'d into the sibling.
    r.apply(r.fail(SUBTRACTS), r.pass());
    const prompt = await runHook(
      "user-prompt-submit",
      recorded("user-prompt-submit", other.root),
      deps,
    );
    const batch = await runHook("post-tool-batch", recorded("post-tool-batch", other.root), deps);
    const pre = await runHook("pre-tool-use", recorded("pre-tool-use", other.root), deps);
    expect([prompt.exitCode, batch.exitCode, pre.exitCode]).toEqual([0, 0, 0]);

    expect(ensured.filter((root) => root !== r.root)).toEqual([]);
    expect(r.store.consumers.get(consumerIn(other.id))).toBeNull();
    expect(r.store.consumers.get(consumerIn(r.worktreeId))).not.toBeNull();
    // The news is the start root's: its regression, not a registration in the sibling.
    expect(`${prompt.stdout}${batch.stdout}`).toContain("math > subtracts");
  });

  it("locates each hook's own cwd without a session root store, as before", async () => {
    const { r, other, ensured, deps, consumerIn } = started();
    const { sessionRoots: _, ...unkept } = deps;
    await runHook("session-start", recorded("session-start", r.root), unkept);
    await runHook("post-tool-batch", recorded("post-tool-batch", other.root), unkept);
    expect(ensured).toContain(other.root);
    expect(r.store.consumers.get(consumerIn(other.id))).not.toBeNull();
  });

  it("resolves the root again on startup and resume, keeps it through compact, and forgets it at SessionEnd", async () => {
    const { r, other, runtime, deps } = started();
    const roots = sessionRootFiles({ XDG_RUNTIME_DIR: runtime });
    await runHook("session-start", recorded("session-start", r.root), deps);
    await runHook(
      "session-start",
      recorded("session-start", other.root, { source: "compact" }),
      deps,
    );
    expect(roots.get(SESSION)?.root).toBe(r.root);
    await runHook("session-start", recorded("subagent-start", other.root), deps);
    expect(roots.get(SESSION)?.root).toBe(r.root);
    await runHook(
      "session-start",
      recorded("session-start", other.root, { source: "resume" }),
      deps,
    );
    expect(roots.get(SESSION)?.root).toBe(other.root);

    await runHook("session-end", recorded("session-end", r.root), deps);
    expect(roots.get(SESSION)).toBeNull();
    expect(readdirSync(join(runtime, "squeal-sessions"))).toEqual([]);
  });

  it("keeps the first root a hook resolves when the start had none, or the kept one is gone", async () => {
    const { r, other, runtime, deps } = started();
    const roots = sessionRootFiles({ XDG_RUNTIME_DIR: runtime });
    await runHook("session-start", recorded("session-start", "/"), deps);
    expect(roots.get(SESSION)).toBeNull();
    await runHook("post-tool-batch", recorded("post-tool-batch", r.root), deps);
    await runHook("post-tool-batch", recorded("post-tool-batch", other.root), deps);
    expect(roots.get(SESSION)?.root).toBe(r.root);

    // A removed worktree keeps nothing: the next hook's cwd is the session's root.
    roots.set(SESSION, { root: join(runtime, "gone"), commonDir: r.repo.commonDir });
    expect(roots.get(SESSION)).toBeNull();
    await runHook("post-tool-batch", recorded("post-tool-batch", other.root), deps);
    expect(roots.get(SESSION)?.root).toBe(other.root);
    rmSync(join(runtime, "squeal-sessions"), { recursive: true });
    expect(roots.get(SESSION)).toBeNull();
  });
});

describe("Codex hooks stay on the thread's root (task 001-405)", () => {
  it("a tool call whose cwd is another worktree starts nothing there and reports the thread's own root", async () => {
    const { r, other, ensured, deps } = started();
    const start = codexInput("exec", "session-start", r.root);
    const session = { session_id: start.session_id, transcript_path: start.transcript_path };
    await runCodexHook("session-start", codexRecorded("exec", "session-start", r.root), deps);
    expect(ensured).toEqual([r.root]);

    r.apply(r.fail(SUBTRACTS), r.pass());
    const prompt = await runCodexHook(
      "user-prompt-submit",
      codexRecorded("exec", "user-prompt-submit", other.root, session),
      deps,
    );
    const post = await runCodexHook(
      "post-tool-use",
      codexRecorded("exec", "post-tool-use", other.root, session),
      deps,
    );

    expect(ensured.filter((root) => root !== r.root)).toEqual([]);
    const consumer = { sessionId: String(start.session_id), agentId: MAIN_AGENT };
    expect(r.store.consumers.get({ worktreeId: other.id, ...consumer })).toBeNull();
    expect(r.store.consumers.get({ worktreeId: r.worktreeId, ...consumer })).not.toBeNull();
    expect(`${prompt.stdout}${post.stdout}`).toContain("math > subtracts");
  });
});

describe("OpenCode stays on the instance's worktree (task 001-405)", () => {
  it("a bash call whose workdir is another worktree starts nothing there and reports the instance's own", async () => {
    const { r, other, ensured, deps, consumerIn } = started();
    const about = { consumer: { sessionId: SESSION }, worktree: r.root, pid: process.pid };
    const opencode: HookDeps = {
      ...bridgeDeps(new URL("file:///pkg/dist/hooks/after.mjs"), about),
      ...deps,
    };
    await register({ kind: "register", ...about }, opencode);
    r.apply(r.fail(SUBTRACTS), r.pass());
    await before(
      { kind: "before", ...about, tool: "bash", command: "git status", workdir: other.root },
      opencode,
    );
    const { text } = await after({ kind: "after", ...about, tool: "bash" }, opencode);

    expect(ensured.filter((root) => root !== r.root)).toEqual([]);
    expect(r.store.consumers.get(consumerIn(other.id))).toBeNull();
    expect(text).toContain("math > subtracts");
  });
});
