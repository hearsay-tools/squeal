import { describe, expect, it } from "vitest";
import { parseCodexInput } from "../../../src/harness/codex/input.js";
import { codexInput, codexRecorded, fixtureNames, MODES } from "./helpers.js";

describe("parseCodexInput", () => {
  it.each(MODES.flatMap((mode) => fixtureNames(mode).map((name) => [mode, name] as const)))(
    "reads %s %s with the fields Squeal uses",
    (mode, name) => {
      const raw = codexInput(mode, name, "/repo");
      const input = parseCodexInput(codexRecorded(mode, name, "/repo"));
      const keep = [
        "session_id",
        "agent_id",
        "agent_type",
        "turn_id",
        "cwd",
        "hook_event_name",
        "tool_name",
        "stop_hook_active",
        "source",
      ];
      expect(input).toEqual(
        Object.fromEntries(keep.flatMap((k) => (k in raw ? [[k, raw[k]]] : []))),
      );
    },
  );

  it("names a subagent's tool call by its agent id and the main thread's by none", () => {
    expect(parseCodexInput(codexRecorded("exec", "subagent-post-tool-use", "/r"))).toMatchObject({
      session_id: "01a11729-e175-7433-b300-3637cf90f1c7",
      agent_id: "01a1172a-28d5-7522-91ff-2c4a65f25950",
      agent_type: "default",
    });
    expect(parseCodexInput(codexRecorded("exec", "post-tool-use", "/r"))).not.toHaveProperty(
      "agent_id",
    );
  });

  it.each([
    ["not JSON", "{not json"],
    ["not an object", "[]"],
    ["no session id", JSON.stringify({ cwd: "/r", hook_event_name: "Stop" })],
    ["an empty session id", JSON.stringify({ session_id: "", cwd: "/r", hook_event_name: "Stop" })],
    ["no cwd", JSON.stringify({ session_id: "s", hook_event_name: "Stop" })],
    ["no event name", JSON.stringify({ session_id: "s", cwd: "/r" })],
  ])("returns null for %s", (_, text) => {
    expect(parseCodexInput(text)).toBeNull();
  });

  it("drops an empty agent id and fields of the wrong type", () => {
    const text = JSON.stringify({
      session_id: "s",
      cwd: "/r",
      hook_event_name: "Stop",
      agent_id: "",
      stop_hook_active: "yes",
      tool_name: 3,
    });
    expect(parseCodexInput(text)).toEqual({ session_id: "s", cwd: "/r", hook_event_name: "Stop" });
  });
});
