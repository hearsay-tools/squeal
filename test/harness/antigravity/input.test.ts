import { describe, expect, it } from "vitest";
import { parseAntigravityInput } from "../../../src/harness/antigravity/input.js";
import { CONVERSATION, fixtureNames, rawFixture } from "./helpers.js";

/* Spec 024 D2, D3 and D5: the camelCase protojson stdin of every Antigravity hook. */

describe("parseAntigravityInput", () => {
  it.each(fixtureNames())("reads the fixture %s", (name) => {
    const input = parseAntigravityInput(rawFixture(name));
    expect(input?.cwd).toBe("/home/user/project");
    expect(input?.conversationId).toMatch(/^00000000-0000-4000-8000-00000000000[12]$/);
    expect(input?.hookEventName).toMatch(/^(SessionStart|PreInvocation|PreToolUse|Stop)$/);
  });

  it("reads PreInvocation's counters", () => {
    expect(parseAntigravityInput(rawFixture("pre-invocation-first"))).toEqual({
      conversationId: CONVERSATION,
      cwd: "/home/user/project",
      workspacePaths: ["/home/user/project"],
      hookEventName: "PreInvocation",
      invocationNum: 0,
      initialNumSteps: 1,
    });
    expect(parseAntigravityInput(rawFixture("pre-invocation-after-tools"))?.invocationNum).toBe(1);
  });

  it("reads Stop's fields", () => {
    expect(parseAntigravityInput(rawFixture("stop-continued"))).toEqual({
      conversationId: CONVERSATION,
      cwd: "/home/user/project",
      workspacePaths: ["/home/user/project"],
      hookEventName: "Stop",
      executionNum: 1,
      terminationReason: "NO_TOOL_CALL",
      fullyIdle: true,
      continuationActive: false,
    });
  });

  it("reads an edit tool's name and no command", () => {
    const input = parseAntigravityInput(rawFixture("pre-tool-use-write-file"));
    expect(input?.toolName).toBe("write_file");
    expect(input).not.toHaveProperty("command");
    expect(input).not.toHaveProperty("toolCwd");
  });

  it("reads run_command's CommandLine, and its Cwd when it has one", () => {
    const raw = JSON.parse(rawFixture("pre-tool-use-run-command")) as {
      toolCall: { args: Record<string, unknown> };
    };
    expect(parseAntigravityInput(JSON.stringify(raw))).toMatchObject({
      toolName: "run_command",
      command: "ls src",
    });
    expect(parseAntigravityInput(JSON.stringify(raw))).not.toHaveProperty("toolCwd");
    raw.toolCall.args.Cwd = "/home/user/project/src";
    expect(parseAntigravityInput(JSON.stringify(raw))).toMatchObject({
      command: "ls src",
      toolCwd: "/home/user/project/src",
    });
  });

  it("takes no command from another tool's CommandLine", () => {
    const raw = JSON.parse(rawFixture("pre-tool-use-write-file")) as {
      toolCall: { args: Record<string, unknown> };
    };
    raw.toolCall.args.CommandLine = "npx vitest run";
    expect(parseAntigravityInput(JSON.stringify(raw))).not.toHaveProperty("command");
  });

  it("falls back to the first workspace path when cwd is empty", () => {
    const raw = { ...JSON.parse(rawFixture("stop")), cwd: "", workspacePaths: ["/w/a", "/w/b"] };
    expect(parseAntigravityInput(JSON.stringify(raw))?.cwd).toBe("/w/a");
  });

  it.each([
    ["not JSON", "{"],
    ["an array", "[]"],
    ["null", "null"],
    ["no conversationId", JSON.stringify({ cwd: "/p", hookEventName: "Stop" })],
    [
      "an empty conversationId",
      JSON.stringify({ conversationId: "", cwd: "/p", hookEventName: "Stop" }),
    ],
    [
      "no cwd and no workspace",
      JSON.stringify({ conversationId: "c", cwd: "", workspacePaths: [], hookEventName: "Stop" }),
    ],
    ["no hookEventName", JSON.stringify({ conversationId: "c", cwd: "/p" })],
  ])("is null for %s", (_, text) => {
    expect(parseAntigravityInput(text)).toBeNull();
  });
});
