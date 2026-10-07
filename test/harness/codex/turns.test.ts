import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readTurn } from "../../../src/core/delivery/turn.js";
import { type Consumer, MAIN_AGENT } from "../../../src/core/types/index.js";
import { REPO_ROOT } from "../../../src/harness/claude-code/build.js";
import {
  type CodexHookName,
  type CodexHookResult,
  runCodexHook,
} from "../../../src/harness/codex/index.js";
import { CONTEXT_CAP_CHARS } from "../../../src/harness/codex/output.js";
import type { HookDeps } from "../../../src/harness/shared/hook.js";
import { PRIMER } from "../../../src/harness/shared/primer.js";
import { outsideGit } from "../bundle-helpers.js";
import { type SquealRepo, SUBTRACTS, squealRepo } from "../helpers.js";
import { codexInput, codexRecorded, sessionOf } from "./helpers.js";

/* Spec 002 goals 2 to 6 on the handlers, from recorded `codex exec` input. */

const SILENT: CodexHookResult = { stdout: "", stderr: "" };
const deps: HookDeps = { env: {}, ensureDaemon: async () => "alive" };

const hook = (r: SquealRepo, name: CodexHookName, fixture: string) =>
  runCodexHook(name, codexRecorded("exec", fixture, r.root), deps);

const SESSION = String(codexInput("exec", "session-start", "/").session_id);
/** Moves a recorded input of another session into this one. */
const IN_SESSION = sessionOf("exec", "session-start");
const AGENT = String(codexInput("exec", "subagent-start", "/").agent_id);
const consumer = (r: SquealRepo, agentId: string = MAIN_AGENT): Consumer => ({
  worktreeId: r.worktreeId,
  sessionId: SESSION,
  agentId,
});

/** Registered with `math > adds` passing and a prompt submitted: in a turn. */
async function inTurn(): Promise<SquealRepo> {
  const r = squealRepo();
  r.apply(r.pass(), r.pass(SUBTRACTS));
  await hook(r, "session-start", "session-start");
  await hook(r, "user-prompt-submit", "user-prompt-submit");
  return r;
}

describe("PostToolUse (goal 2)", () => {
  it("speaks once over three calls of one batch with one transition", async () => {
    const r = await inTurn();
    r.apply(r.fail());
    const outs = [];
    for (let i = 0; i < 3; i++) outs.push(await hook(r, "post-tool-use", "post-tool-use"));
    expect(outs[0]?.stdout).toContain("PASS -> FAIL");
    expect(outs.slice(1)).toEqual([SILENT, SILENT]);
  });

  it("says the matching FAIL -> PASS and nothing for an unchanged failure", async () => {
    const r = await inTurn();
    r.apply(r.fail());
    await hook(r, "post-tool-use", "post-tool-use");
    r.apply(r.fail());
    expect(await hook(r, "post-tool-use", "post-tool-use")).toEqual(SILENT);
    r.apply(r.pass());
    expect((await hook(r, "post-tool-use", "post-tool-use")).stdout).toContain("FAIL -> PASS");
  });
});

describe("PreToolUse deny (goal 3)", () => {
  it("denies apply_patch once per regression and never Bash", async () => {
    const r = await inTurn();
    r.apply(r.fail());
    expect(await hook(r, "pre-tool-use", "pre-tool-use")).toEqual(SILENT);
    const first = await hook(r, "pre-tool-use", "pre-tool-use-apply-patch");
    expect(first.stdout).toContain('"permissionDecision":"deny"');
    expect(await hook(r, "pre-tool-use", "pre-tool-use-apply-patch")).toEqual(SILENT);

    r.apply(r.fail(), r.fail(SUBTRACTS));
    expect(await hook(r, "pre-tool-use", "pre-tool-use")).toEqual(SILENT);
    const second = await hook(r, "pre-tool-use", "pre-tool-use-apply-patch");
    expect(second.stdout).toContain("math > subtracts");
    expect(await hook(r, "pre-tool-use", "pre-tool-use-apply-patch")).toEqual(SILENT);
  });

  it("does not deny with interrupt.onRegression off", async () => {
    const r = await inTurn();
    r.policy({ interrupt: { onRegression: false } });
    r.apply(r.fail());
    expect(await hook(r, "pre-tool-use", "pre-tool-use-apply-patch")).toEqual(SILENT);
    expect((await hook(r, "post-tool-use", "post-tool-use")).stdout).toContain("PASS -> FAIL");
  });

  it("puts a consumer left idle in a turn before a Bash call", async () => {
    const r = await inTurn();
    expect(await hook(r, "stop", "stop")).toEqual(SILENT);
    expect(readTurn(r.store, consumer(r)).turn).toBe("idle");
    await hook(r, "pre-tool-use", "pre-tool-use");
    expect(readTurn(r.store, consumer(r)).turn).toBe("in-turn");
  });
});

describe("Stop and Interrupt (goals 4 and 6)", () => {
  it("ends the turn when it has nothing to say", async () => {
    const r = await inTurn();
    expect(await hook(r, "stop", "stop")).toEqual(SILENT);
    expect(readTurn(r.store, consumer(r)).turn).toBe("idle");
  });

  it("blocks on known failures, then never again under stop_hook_active", async () => {
    const r = await inTurn();
    r.policy({ stop: { blockOnKnownFailures: true } });
    r.apply(r.fail());
    const first = await hook(r, "stop", "stop");
    expect(JSON.parse(first.stdout)).toEqual({
      decision: "block",
      reason: expect.stringMatching(/^Squeal policy stop.blockOnKnownFailures is on/),
    });
    expect(readTurn(r.store, consumer(r)).turn).toBe("in-turn");

    // A regression lands during the continuation: the active Stop still ends the turn silently.
    r.apply(r.fail(), r.fail(SUBTRACTS));
    const again = runCodexHook(
      "stop",
      codexRecorded("exec", "stop-hook-active", r.root, IN_SESSION),
      deps,
    );
    expect(await again).toEqual(SILENT);
    expect(readTurn(r.store, consumer(r)).turn).toBe("idle");
    // What it did not say waits for the next prompt.
    const prompt = await hook(r, "user-prompt-submit", "user-prompt-submit");
    expect(prompt.stdout).toContain("math > subtracts");
  });

  it("ends the turn at an interrupt and keeps the delta for the next prompt", async () => {
    const r = await inTurn();
    await hook(r, "pre-tool-use", "pre-tool-use");
    r.apply(r.fail());
    // The TUI's recorded Interrupt (Escape mid-tool), in this session.
    const input = codexRecorded("tui", "interrupt", r.root, IN_SESSION);
    expect(await runCodexHook("interrupt", input, deps)).toEqual(SILENT);
    expect(readTurn(r.store, consumer(r)).turn).toBe("idle");
    expect((await hook(r, "user-prompt-submit", "user-prompt-submit")).stdout).toContain(
      "PASS -> FAIL",
    );
  });

  it("registers again on a prompt after the daemon expired the consumer", async () => {
    const r = squealRepo();
    r.apply(r.pass());
    const out = await hook(r, "user-prompt-submit", "user-prompt-submit");
    expect(out.stdout).toContain("SQUEAL · registered at revision 1");
    expect(r.store.consumers.get(consumer(r))).not.toBeNull();
  });
});

describe("subagents (goal 5)", () => {
  it("tell a subagent at SubagentStart what the main agent hears: header and primer", async () => {
    const r = await inTurn();
    const out = await hook(r, "subagent-start", "subagent-start");
    expect(JSON.parse(out.stdout)).toEqual({
      hookSpecificOutput: {
        hookEventName: "SubagentStart",
        additionalContext: expect.stringMatching(/^SQUEAL · registered at revision 1\n/),
      },
    });
    expect(out.stdout).toContain(JSON.stringify(PRIMER).slice(1, -1));
    expect(JSON.parse(out.stdout).hookSpecificOutput.additionalContext.length).toBeLessThanOrEqual(
      CONTEXT_CAP_CHARS,
    );
    expect(r.store.consumers.get(consumer(r, AGENT))).not.toBeNull();
    // The subagent heard it: its first tool boundary has nothing to add.
    expect(await hook(r, "post-tool-use", "subagent-post-tool-use")).toEqual(SILENT);
  });

  it("deliver a subagent's tool events only to (session_id, agent_id)", async () => {
    const r = await inTurn();
    await hook(r, "subagent-start", "subagent-start");
    r.apply(r.fail());

    const sub = await hook(r, "post-tool-use", "subagent-post-tool-use");
    expect(sub.stdout).toContain("PASS -> FAIL");
    expect(await hook(r, "post-tool-use", "subagent-post-tool-use")).toEqual(SILENT);
    // The parent's view is untouched: it still has the regression to hear.
    expect((await hook(r, "post-tool-use", "post-tool-use")).stdout).toContain("PASS -> FAIL");

    expect(await hook(r, "subagent-stop", "subagent-stop")).toEqual(SILENT);
    expect(r.store.consumers.get(consumer(r, AGENT))).toBeNull();
    expect(r.store.consumers.get(consumer(r))).not.toBeNull();
  });

  it("deny a subagent's apply_patch without touching the parent's regression", async () => {
    const r = await inTurn();
    await hook(r, "subagent-start", "subagent-start");
    r.apply(r.fail());
    const deny = await runCodexHook(
      "pre-tool-use",
      codexRecorded("exec", "subagent-pre-tool-use", r.root, { tool_name: "apply_patch" }),
      deps,
    );
    expect(deny.stdout).toContain('"permissionDecision":"deny"');
    expect((await hook(r, "pre-tool-use", "pre-tool-use-apply-patch")).stdout).toContain(
      '"permissionDecision":"deny"',
    );
  });
});

describe("SessionEnd (goal 6)", () => {
  it("unregisters the main agent and its subagents", async () => {
    const r = await inTurn();
    await hook(r, "subagent-start", "subagent-start");
    expect(await hook(r, "session-end", "session-end")).toEqual(SILENT);
    expect(r.store.consumers.list(r.worktreeId)).toEqual([]);
  });
});

describe("no CLAUDE_* variable (D4)", () => {
  it("leaves a store named by CLAUDE_PROJECT_DIR alone when the cwd is outside git", async () => {
    const r = await inTurn();
    const env = { CLAUDE_PROJECT_DIR: r.root, CLAUDE_CODE_SESSION_ATTENDED: "1" };
    for (const [name, fixture] of [
      ["session-end", "session-end"],
      ["post-tool-use", "post-tool-use"],
      ["stop", "stop"],
    ] as const) {
      const out = await runCodexHook(name, codexRecorded("exec", fixture, outsideGit()), {
        ...deps,
        env,
      });
      expect(out, name).toEqual(SILENT);
    }
    expect(r.store.consumers.get(consumer(r))).not.toBeNull();
  });

  it("is never named in the Codex adapter's source", () => {
    const dir = join(REPO_ROOT, "src/harness/codex");
    const files = readdirSync(dir, { recursive: true, encoding: "utf8" }).filter((f) =>
      f.endsWith(".ts"),
    );
    for (const file of files) {
      expect(readFileSync(join(dir, file), "utf8"), file).not.toMatch(/\bCLAUDE_[A-Z]/);
    }
  });
});

describe("SessionEnd (goal 6)", () => {
  it("sweeps the store of its cwd only, never one named by CLAUDE_PROJECT_DIR", async () => {
    const first = await inTurn();
    const moved = await inTurn();
    const env = { CLAUDE_PROJECT_DIR: first.root };
    const end = codexRecorded("exec", "session-end", moved.root);
    expect(await runCodexHook("session-end", end, { ...deps, env })).toEqual(SILENT);
    expect(moved.store.consumers.list(moved.worktreeId)).toEqual([]);
    // Left to the next startup or resume SessionStart there, or to daemon expiry.
    expect(first.store.consumers.get(consumer(first))).not.toBeNull();
  });
});
