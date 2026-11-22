import { describe, expect, it } from "vitest";
import { waitConsumer } from "../../src/cli/status-wait.js";

/*
 * Spec 024 D2 (row 024-02): Antigravity sets ANTIGRAVITY_CONVERSATION_ID in
 * every `run_command` shell, so a `status --wait` pulled there credits that
 * conversation's consumers, as for Claude Code and Codex.
 */

describe("a status --wait pull from an Antigravity shell (spec 024 D2)", () => {
  it("reads the consumer from ANTIGRAVITY_CONVERSATION_ID", () => {
    const id = "3f1c2b9e-0d4a-4c1e-9a7b-5e6f7a8b9c0d";
    expect(waitConsumer({ ANTIGRAVITY_CONVERSATION_ID: id })).toEqual({ session: id, agent: null });
  });

  it("names no session for an empty id", () => {
    expect(waitConsumer({ ANTIGRAVITY_CONVERSATION_ID: "" })).toEqual({
      session: null,
      agent: null,
    });
  });

  it("keeps the Claude Code and Codex sessions first", () => {
    const env = { ANTIGRAVITY_CONVERSATION_ID: "agy" };
    expect(waitConsumer({ ...env, CLAUDE_CODE_SESSION_ID: "cc" }).session).toBe("cc");
    expect(waitConsumer({ ...env, CODEX_SESSION_ID: "cx" }).session).toBe("cx");
  });
});
