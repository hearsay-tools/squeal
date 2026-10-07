import { describe, expect, it } from "vitest";
import { readTurn } from "../../src/core/delivery/turn.js";
import { type HookDeps, type HookResult, runHook } from "../../src/harness/claude-code/index.js";
import { recorded, type SquealRepo, SUBAGENT, squealRepo } from "./helpers.js";

/*
 * Task 001-93 (lessons, defect 14 after wave 10, case 5b): PreToolUse runs on
 * every tool, so a turn another Stop hook continued after Squeal's silent Stop
 * is a turn again before its first call runs. Deny-once stays on edits.
 */

const SILENT: HookResult = { stdout: "", stderr: "", exitCode: 0 };
const deps: HookDeps = { env: {}, ensureDaemon: async () => "alive" };

const BASH = { tool_name: "Bash", tool_input: { command: "sleep 15" } };
const READ = { tool_name: "Read", tool_input: { file_path: "/repo/src/math.ts" } };

const hook = (name: string, r: SquealRepo, overrides: object = {}) =>
  runHook(name, recorded(name, r.root, overrides), deps);

/** Registered with `math > adds` passing, then a regression the consumer was not told. */
async function regressed(): Promise<SquealRepo> {
  const r = squealRepo();
  r.apply(r.pass());
  await hook("session-start", r);
  r.apply(r.fail());
  return r;
}

/** Registered, a prompt and a silent Stop: idle, as another Stop hook's block leaves it. */
async function leftIdle(): Promise<SquealRepo> {
  const r = squealRepo();
  r.apply(r.pass());
  await hook("session-start", r);
  await hook("user-prompt-submit", r);
  expect(await hook("stop", r)).toEqual(SILENT);
  expect(readTurn(r.store, r.consumer()).turn).toBe("idle");
  return r;
}

describe("PreToolUse on every tool (task 001-93)", () => {
  it.each([
    ["Bash", BASH],
    ["Read", READ],
  ])("never denies %s, and leaves the regression for PostToolBatch", async (_, tool) => {
    const r = await regressed();
    expect(await hook("pre-tool-use", r, tool)).toEqual(SILENT);
    expect((await hook("post-tool-batch", r)).stdout).toContain("PASS -> FAIL");
  });

  it.each(["Edit", "Write", "NotebookEdit"])("denies %s once on a regression", async (tool) => {
    const r = await regressed();
    const deny = await hook("pre-tool-use", r, { tool_name: tool });
    expect(deny.stdout).toContain('"permissionDecision":"deny"');
    expect(await hook("pre-tool-use", r, { tool_name: tool })).toEqual(SILENT);
  });

  it.each([
    ["Bash, policy on", BASH, true],
    ["Bash, policy off", BASH, false],
    ["Edit, policy off", { tool_name: "Edit" }, false],
    ["Edit, policy on, nothing to deny", { tool_name: "Edit" }, true],
  ])("puts a consumer left idle in a turn: %s", async (_, tool, onRegression) => {
    const r = await leftIdle();
    r.policy({ interrupt: { onRegression } });
    expect(await hook("pre-tool-use", r, tool)).toEqual(SILENT);
    expect(readTurn(r.store, r.consumer()).turn).toBe("in-turn");
  });

  it("writes no turn for a consumer without a registration", async () => {
    const r = squealRepo();
    r.apply(r.pass());
    expect(await hook("pre-tool-use", r, BASH)).toEqual(SILENT);
    expect(r.store.consumers.get(r.consumer())).toBeNull();
    expect(r.store.meta.get(`turn:${r.worktreeId}`)).toBeNull();
  });

  it("ignores a fork: its tool call leaves the main agent idle", async () => {
    const r = await leftIdle();
    const fork = { ...BASH, agent_id: SUBAGENT, agent_type: "" };
    expect(await hook("pre-tool-use", r, fork)).toEqual(SILENT);
    expect(readTurn(r.store, r.consumer()).turn).toBe("idle");
  });
});
