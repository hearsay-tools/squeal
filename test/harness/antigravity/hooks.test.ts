import { describe, expect, it } from "vitest";
import { testCommandDenied } from "../../../src/core/delivery/test-command-denied.js";
import { readTurn } from "../../../src/core/delivery/turn.js";
import { omittedTestFilesMetaKey } from "../../../src/core/scheduler/omitted-test-files.js";
import { type Consumer, MAIN_AGENT } from "../../../src/core/types/delivery.js";
import {
  type AntigravityHookName,
  runAntigravityHook,
} from "../../../src/harness/antigravity/hooks.js";
import { MESSAGE_CAP_CHARS } from "../../../src/harness/antigravity/output.js";
import type { AntigravityHookResult } from "../../../src/harness/antigravity/run.js";
import type { HookDeps } from "../../../src/harness/shared/hook.js";
import { PRIMER } from "../../../src/harness/shared/primer.js";
import { outsideGit } from "../bundle-helpers.js";
import { type SquealRepo, SUBTRACTS, squealRepo } from "../helpers.js";
import {
  antigravityRecorded,
  CONVERSATION,
  EDIT_FIXTURES,
  injected,
  SUBAGENT_CONVERSATION,
} from "./helpers.js";

/* Spec 024 goals 1 to 3 and 5 on the handlers, from the fixtures of `antigravity` 1.5.14. */

const SILENT: AntigravityHookResult = { stdout: "", stderr: "" };
const deps: HookDeps = { env: {}, ensureDaemon: async () => "alive" };

const hook = (r: SquealRepo, name: AntigravityHookName, fixture: string, overrides: object = {}) =>
  runAntigravityHook(name, antigravityRecorded(fixture, r.root, overrides), deps);

const consumer = (r: SquealRepo, sessionId = CONVERSATION): Consumer => ({
  worktreeId: r.worktreeId,
  sessionId,
  agentId: MAIN_AGENT,
});

/** Registered with `math > adds` and `math > subtracts` passing, and a turn started. */
async function inTurn(): Promise<SquealRepo> {
  const r = squealRepo();
  r.apply(r.pass(), r.pass(SUBTRACTS));
  await hook(r, "session-start", "session-start");
  await hook(r, "pre-invocation", "pre-invocation-first");
  return r;
}

describe("SessionStart (D3)", () => {
  it("registers (conversationId, main) and injects the header and the primer", async () => {
    const r = squealRepo();
    r.apply(r.pass());
    const out = await hook(r, "session-start", "session-start");
    expect(out.stderr).toBe("");
    const text = injected(out);
    expect(text).toMatch(/^SQUEAL · registered at revision 1\n/);
    expect(text.endsWith(PRIMER)).toBe(true);
    expect(text.length).toBeLessThanOrEqual(MESSAGE_CAP_CHARS);
    expect(r.store.consumers.get(consumer(r))).not.toBeNull();
  });

  it("is silent outside a git worktree", async () => {
    const out = await runAntigravityHook(
      "session-start",
      antigravityRecorded("session-start", outsideGit()),
      deps,
    );
    expect(out).toEqual(SILENT);
  });
});

describe("PreInvocation (goals 1 and 2)", () => {
  it("invocationNum 0 starts the turn and says what landed while idle", async () => {
    const r = await inTurn();
    expect(await hook(r, "stop", "stop")).toEqual(SILENT);
    expect(readTurn(r.store, consumer(r)).turn).toBe("idle");
    r.apply(r.fail(), r.pass(SUBTRACTS));
    const out = await hook(r, "pre-invocation", "pre-invocation-first");
    expect(injected(out)).toContain("PASS -> FAIL");
    expect(readTurn(r.store, consumer(r)).turn).toBe("in-turn");
  });

  it("invocationNum 0 registers a conversation that has no consumer, as on a resume", async () => {
    const r = squealRepo();
    r.apply(r.pass());
    const text = injected(await hook(r, "pre-invocation", "pre-invocation-first"));
    expect(text).toMatch(/^SQUEAL · registered at revision 1\n/);
    expect(text.endsWith(PRIMER)).toBe(true);
    expect(r.store.consumers.get(consumer(r))).not.toBeNull();
  });

  it("invocationNum > 0 delivers once per batch, then FAIL -> PASS, never an unchanged failure", async () => {
    const r = await inTurn();
    r.apply(r.fail(), r.pass(SUBTRACTS));
    const first = await hook(r, "pre-invocation", "pre-invocation-after-tools");
    expect(injected(first)).toMatch(/^SQUEAL · 1 check changed \(1 test\) at revision 2\n/);
    expect(injected(first)).toContain("PASS -> FAIL");
    expect(await hook(r, "pre-invocation", "pre-invocation-after-tools")).toEqual(SILENT);
    r.apply(r.fail(), r.pass(SUBTRACTS));
    expect(await hook(r, "pre-invocation", "pre-invocation-after-tools")).toEqual(SILENT);
    r.apply(r.pass(), r.pass(SUBTRACTS));
    const back = await hook(r, "pre-invocation", "pre-invocation-after-tools");
    expect(injected(back)).toContain("FAIL -> PASS");
  });

  it("is silent for PASS -> PASS", async () => {
    const r = await inTurn();
    r.apply(r.pass(), r.pass(SUBTRACTS));
    expect(await hook(r, "pre-invocation", "pre-invocation-after-tools")).toEqual(SILENT);
  });
});

describe("PreToolUse (goal 3)", () => {
  it.each(EDIT_FIXTURES)("denies %s once per regression", async (tool, fixture) => {
    const r = await inTurn();
    r.apply(r.fail(), r.pass(SUBTRACTS));
    const out = await hook(r, "pre-tool-use", fixture);
    expect(out.stderr).toBe("");
    expect(JSON.parse(out.stdout)).toEqual({
      decision: "deny",
      reason: expect.stringMatching(
        new RegExp(`PASS -> FAIL[\\s\\S]*denied this ${tool} call, so the edit was not applied`),
      ),
    });
    expect(await hook(r, "pre-tool-use", fixture)).toEqual(SILENT);
  });

  it("does not deny an edit with interrupt.onRegression off", async () => {
    const r = await inTurn();
    r.policy({ interrupt: { onRegression: false } });
    r.apply(r.fail(), r.pass(SUBTRACTS));
    expect(await hook(r, "pre-tool-use", "pre-tool-use-write-file")).toEqual(SILENT);
    const news = await hook(r, "pre-invocation", "pre-invocation-after-tools");
    expect(injected(news)).toContain("PASS -> FAIL");
  });

  it("never denies run_command by default, and puts an idle consumer in a turn", async () => {
    const r = await inTurn();
    await hook(r, "stop", "stop");
    r.apply(r.fail(), r.pass(SUBTRACTS));
    expect(await hook(r, "pre-tool-use", "pre-tool-use-run-command")).toEqual(SILENT);
    expect(readTurn(r.store, consumer(r)).turn).toBe("in-turn");
  });

  it("denies an answered test command once with testCommand.denyWhenCurrent (spec 005 D8)", async () => {
    const r = squealRepo();
    r.store.meta.set(omittedTestFilesMetaKey(r.worktreeId), "0");
    r.apply(r.pass());
    await hook(r, "session-start", "session-start");
    const run = (CommandLine: string, Cwd?: string) =>
      hook(r, "pre-tool-use", "pre-tool-use-run-command", {
        toolCall: {
          args: { CommandLine, WaitMsBeforeAsync: 1000, ...(Cwd === undefined ? {} : { Cwd }) },
          id: "call_a1B2c3D4e5F6g7H8i9J0",
          name: "run_command",
        },
      });
    expect(await run("npx vitest run")).toEqual(SILENT);
    r.policy({ testCommand: { denyWhenCurrent: true } });
    expect(await run("ls")).toEqual(SILENT);
    // A Cwd outside the worktree: not a test command of this worktree.
    expect(await run("npx vitest run", "/")).toEqual(SILENT);
    const denied = JSON.parse((await run("npx vitest run", r.root)).stdout) as {
      decision: string;
      reason: string;
    };
    expect(denied.decision).toBe("deny");
    expect(denied.reason).toMatch(
      /^The command did not run\. Squeal holds current results at revision 1 for the 1 test file it runs \(src\/math\.test\.ts\)/,
    );
    expect(testCommandDenied(r.store, consumer(r))).toBe(true);
    expect(await run("npx vitest run")).toEqual(SILENT);
  });
});

describe("errors (goal 7)", () => {
  it.each([
    ["malformed stdin", "{"],
    ["an empty object", "{}"],
    [
      "no workspace",
      JSON.stringify({ conversationId: CONVERSATION, cwd: "", hookEventName: "Stop" }),
    ],
  ])("emit empty stdout for %s", async (_, stdin) => {
    expect(await runAntigravityHook("pre-tool-use", stdin, deps)).toEqual(SILENT);
  });

  it("emit empty stdout when a handler throws, and say why only under SQUEAL_HOOK_DEBUG", async () => {
    const r = await inTurn();
    r.apply(r.fail(), r.pass(SUBTRACTS));
    const throwing: HookDeps = {
      ...deps,
      writer: () => {
        throw new Error("boom");
      },
    };
    const stdin = antigravityRecorded("pre-tool-use-write-file", r.root);
    expect(await runAntigravityHook("pre-tool-use", stdin, throwing)).toEqual(SILENT);
    const debug = { ...throwing, env: { SQUEAL_HOOK_DEBUG: "1" } };
    const out = await runAntigravityHook("pre-tool-use", stdin, debug);
    expect(out.stdout).toBe("");
    expect(out.stderr).toMatch(/^squeal antigravity pre-tool-use hook: Error: boom\n$/);
  });
});

describe("subagents (goal 5)", () => {
  it("register a subagent as (its conversationId, main) with the header and the primer", async () => {
    const r = await inTurn();
    const text = injected(await hook(r, "session-start", "subagent-session-start"));
    expect(text).toMatch(/^SQUEAL · registered at revision 1\n/);
    expect(text.endsWith(PRIMER)).toBe(true);
    expect(r.store.consumers.get(consumer(r, SUBAGENT_CONVERSATION))).not.toBeNull();
  });

  it("deliver to the subagent without touching the parent's view", async () => {
    const r = await inTurn();
    await hook(r, "session-start", "subagent-session-start");
    r.apply(r.fail(), r.pass(SUBTRACTS));
    const sub = await hook(r, "pre-invocation", "subagent-pre-invocation-after-tools");
    expect(injected(sub)).toContain("PASS -> FAIL");
    expect(await hook(r, "pre-invocation", "subagent-pre-invocation-after-tools")).toEqual(SILENT);
    const parent = await hook(r, "pre-invocation", "pre-invocation-after-tools");
    expect(injected(parent)).toContain("PASS -> FAIL");
  });

  it("deny the subagent's edit without touching the parent's deny", async () => {
    const r = await inTurn();
    await hook(r, "session-start", "subagent-session-start");
    r.apply(r.fail(), r.pass(SUBTRACTS));
    const sub = await hook(r, "pre-tool-use", "subagent-pre-tool-use-write-file");
    expect(JSON.parse(sub.stdout)).toMatchObject({ decision: "deny" });
    const parent = await hook(r, "pre-tool-use", "pre-tool-use-edit-file");
    expect(JSON.parse(parent.stdout)).toMatchObject({ decision: "deny" });
  });
});
