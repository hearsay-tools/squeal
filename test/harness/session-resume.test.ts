import { describe, expect, it } from "vitest";
import { runHook } from "../../src/harness/claude-code/hooks.js";
import type { HookDeps } from "../../src/harness/shared/hook.js";
import { PRIMER } from "../../src/harness/shared/primer.js";
import { recorded, SESSION, SUBAGENT, squealRepo } from "./helpers.js";

/*
 * Row 005-91 (d): Claude Code resumes a session (at each human turn under Squawk) with its
 * context, which still holds the primer its first run heard. A resumed session gets the
 * registration with no primer; `startup` and `clear` keep it, `compact` says only the primer.
 */

const deps = (): HookDeps => ({ env: {}, ensureDaemon: async () => "alive" });

async function contextOn(source: string | undefined): Promise<string> {
  const r = squealRepo();
  r.apply(r.pass());
  const out = await runHook("session-start", recorded("session-start", r.root, { source }), deps());
  return JSON.parse(out.stdout).hookSpecificOutput.additionalContext;
}

describe("SessionStart on resume (row 005-91 d)", () => {
  it("sends the registration with no primer", async () => {
    const text = await contextOn("resume");
    expect(text).toMatch(/^SQUEAL · registered at revision 1\n/);
    expect(text).not.toContain(PRIMER);
    expect(text).not.toContain("Squeal runs this repository's");
  });

  it.each(["startup", "clear", undefined])("keeps the primer on source %s", async (source) => {
    const text = await contextOn(source);
    expect(text).toMatch(/^SQUEAL · registered at revision 1\n/);
    expect(text.endsWith(`\n\n${PRIMER}`)).toBe(true);
  });

  it("still sweeps the session's other consumers on resume", async () => {
    const r = squealRepo();
    r.apply(r.pass());
    r.store.consumers.register(
      { worktreeId: r.worktreeId, sessionId: SESSION, agentId: SUBAGENT },
      1,
    );
    await runHook("session-start", recorded("session-start", r.root, { source: "resume" }), deps());
    const left = r.store.consumers.list(r.worktreeId).map((c) => c.consumer.agentId);
    expect(left).toEqual(["main"]);
  });
});
