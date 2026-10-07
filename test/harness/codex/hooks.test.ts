import { describe, expect, it } from "vitest";
import { readTurn } from "../../../src/core/delivery/turn.js";
import { type Consumer, MAIN_AGENT } from "../../../src/core/types/index.js";
import { type CodexHookResult, runCodexHook } from "../../../src/harness/codex/index.js";
import type { HookDeps } from "../../../src/harness/shared/hook.js";
import { PRIMER } from "../../../src/harness/shared/primer.js";
import { check } from "../../state/helpers.js";
import { FILE, type SquealRepo, squealRepo } from "../helpers.js";
import {
  allFixtures,
  codexInput,
  codexRecorded,
  HOOK_OF_EVENT,
  type Mode,
  sessionOf,
} from "./helpers.js";

/*
 * Spec 002 D3 on recorded Codex input: every event under `codex exec`, a
 * `codex app-server` thread and the TUI (test/fixtures/codex-hooks).
 */

const SILENT: CodexHookResult = { stdout: "", stderr: "" };
const deps: HookDeps = { env: {}, ensureDaemon: async () => "alive" };

/** Runs the recorded fixture `mode/name` against `r`, through the hook its event names. */
function run(r: SquealRepo, mode: Mode, name: string, overrides: object = {}) {
  const event = String(codexInput(mode, name, r.root).hook_event_name);
  const hook = HOOK_OF_EVENT[event];
  if (hook === undefined) throw new Error(`no Codex hook for ${event}`);
  return runCodexHook(hook, codexRecorded(mode, name, r.root, overrides), deps);
}

const json = (result: CodexHookResult): unknown => JSON.parse(result.stdout);

function consumerOf(r: SquealRepo, mode: Mode, name: string): Consumer {
  const input = codexInput(mode, name, r.root);
  return {
    worktreeId: r.worktreeId,
    sessionId: String(input.session_id),
    agentId: typeof input.agent_id === "string" ? input.agent_id : MAIN_AGENT,
  };
}

/**
 * A repository where the fixture's session is registered (and its subagent,
 * for a subagent's tool or stop event) with `math > adds` passing, then a
 * regression nobody was told.
 */
async function regressed(mode: Mode, name: string): Promise<SquealRepo> {
  const r = squealRepo();
  r.apply(r.pass());
  const input = codexInput(mode, name, r.root);
  // A subagent's transcript is its own; its session's is the main thread's.
  const session =
    typeof input.agent_id === "string" ? { session_id: input.session_id } : sessionOf(mode, name);
  expect(await run(r, mode, "session-start", session)).not.toEqual(SILENT);
  if (typeof input.agent_id === "string" && input.hook_event_name !== "SubagentStart") {
    await run(r, "exec", "subagent-start", { ...session, agent_id: input.agent_id });
  }
  r.apply(r.fail());
  return r;
}

const context = (event: string, pattern: RegExp | string) => ({
  hookSpecificOutput: {
    hookEventName: event,
    additionalContext: typeof pattern === "string" ? pattern : expect.stringMatching(pattern),
  },
});

describe("every recorded Codex event", () => {
  const events = allFixtures().filter(([, , event]) => event !== "SessionStart");

  it.each(events)("%s %s (%s)", async (mode, name, event) => {
    const r = await regressed(mode, name);
    const me = consumerOf(r, mode, name);
    const out = await run(r, mode, name);
    expect(out.stderr).toBe("");
    const tool = String(codexInput(mode, name, r.root).tool_name);
    const active = codexInput(mode, name, r.root).stop_hook_active === true;
    switch (event) {
      case "UserPromptSubmit":
        expect(json(out)).toEqual(context(event, /PASS -> FAIL/));
        expect(readTurn(r.store, me).turn).toBe("in-turn");
        break;
      case "PreToolUse":
        if (tool === "apply_patch") {
          expect(json(out)).toEqual({
            hookSpecificOutput: {
              hookEventName: "PreToolUse",
              permissionDecision: "deny",
              permissionDecisionReason: expect.stringMatching(
                /PASS -> FAIL[\s\S]*denied this apply_patch call, so the edit was not applied\. The same call can be re-issued/,
              ),
            },
          });
        } else {
          expect(out).toEqual(SILENT);
        }
        break;
      case "PostToolUse":
        expect(json(out)).toEqual(context(event, /^SQUEAL · 1 check changed at revision 2\n/));
        break;
      case "Stop":
        if (active) {
          expect(out).toEqual(SILENT);
          expect(readTurn(r.store, me).turn).toBe("idle");
        } else {
          expect(json(out)).toEqual({
            decision: "block",
            reason: expect.stringMatching(
              /^SQUEAL · 1 check changed at revision 2\n[\s\S]*PASS -> FAIL/,
            ),
          });
        }
        break;
      case "SubagentStart":
        expect(json(out)).toEqual({
          hookSpecificOutput: {
            hookEventName: "SubagentStart",
            additionalContext: expect.stringMatching(
              /^SQUEAL · registered at revision 2\n[\s\S]*do not run Vitest/,
            ),
          },
        });
        expect(r.store.consumers.get(me)).not.toBeNull();
        break;
      case "SubagentStop":
        expect(out).toEqual(SILENT);
        expect(r.store.consumers.get(me)).toBeNull();
        expect(r.store.consumers.get({ ...me, agentId: MAIN_AGENT })).not.toBeNull();
        break;
      case "Interrupt":
        expect(out).toEqual(SILENT);
        expect(readTurn(r.store, me).turn).toBe("idle");
        break;
      case "SessionEnd":
        expect(out).toEqual(SILENT);
        expect(r.store.consumers.list(r.worktreeId)).toEqual([]);
        break;
      default:
        throw new Error(`unexpected event ${event}`);
    }
  });
});

describe("SessionStart (D2, D3)", () => {
  const starts = allFixtures().filter(
    ([, name, event]) => event === "SessionStart" && name !== "session-start-compact",
  );

  it.each(starts)("%s %s registers and injects the header and the primer", async (mode, name) => {
    const r = squealRepo();
    r.apply(r.pass());
    const out = await run(r, mode, name);
    expect(json(out)).toEqual(context("SessionStart", /^SQUEAL · registered at revision 1\n/));
    expect(out.stdout).toContain(JSON.stringify(PRIMER).slice(1, -1));
    expect(r.store.consumers.get(consumerOf(r, mode, name))).not.toBeNull();
  });

  it.each([
    ["startup", "exec", "session-start", true],
    ["resume", "exec", "session-start-resume", true],
    ["clear", "tui", "session-start-clear", true],
    ["fork", "exec", "session-start-fork", false],
  ] as const)(
    "source %s sweeps the session's other consumers: %s",
    async (_, mode, name, sweeps) => {
      const r = squealRepo();
      r.apply(r.pass());
      const session = String(codexInput(mode, name, r.root).session_id);
      const left = { worktreeId: r.worktreeId, sessionId: session, agentId: "earlier-subagent" };
      r.store.consumers.register(left, Date.now());
      await run(r, mode, name);
      expect(r.store.consumers.get(left) === null).toBe(sweeps);
    },
  );

  it("after compact keeps the view and says only the primer", async () => {
    const r = squealRepo();
    r.apply(r.pass());
    await run(r, "tui", "session-start");
    r.apply(r.fail());
    const out = await run(r, "tui", "session-start-compact");
    expect(json(out)).toEqual(context("SessionStart", PRIMER));
    expect((await run(r, "tui", "user-prompt-submit")).stdout).toContain("PASS -> FAIL");
  });

  it("stays within 8,000 characters with hundreds of known failures", async () => {
    const r = squealRepo();
    const failures = Array.from({ length: 400 }, (_, i) =>
      r.fail(
        check(`math > case ${i} with a long descriptive name`, FILE),
        `expected ${i} to be ${i + 1}`.repeat(4),
      ),
    );
    r.apply(...failures);
    const out = await run(r, "exec", "session-start");
    const text = (json(out) as { hookSpecificOutput: { additionalContext: string } })
      .hookSpecificOutput.additionalContext;
    expect(text.length).toBeLessThanOrEqual(8_000);
    expect(text.endsWith(PRIMER)).toBe(true);
    expect(text).toMatch(/^SQUEAL · registered at revision 1\n/);
  });
});
