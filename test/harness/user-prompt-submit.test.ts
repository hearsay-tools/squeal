import { describe, expect, it } from "vitest";
import { readTurn } from "../../src/core/delivery/turn.js";
import { type HookDeps, type HookResult, runHook } from "../../src/harness/claude-code/index.js";
import { fakeRepo } from "../status/helpers.js";
import { recorded, squealRepo } from "./helpers.js";

/*
 * Lessons, defects 8 and 10 (task 001-47): an interrupted turn runs no Stop,
 * and a consumer whose waiter is gone expires after 10 minutes. UserPromptSubmit
 * arms the waiter (hooks.json) and brings back a registration that expired
 * while the session sat idle. Review wave 6, S1: whenever it registers, it
 * injects the registration, since context on a prompt starts no extra turn.
 */

const SILENT: HookResult = { stdout: "", stderr: "", exitCode: 0 };
const INTERACTIVE = { CLAUDE_CODE_SESSION_ATTENDED: "1", CLAUDE_CODE_ENTRYPOINT: "cli" };

function deps(overrides: Partial<HookDeps> = {}): HookDeps {
  return { env: INTERACTIVE, ensureDaemon: async () => "alive", ...overrides };
}

const prompt = (root: string) => recorded("user-prompt-submit", root);

describe("UserPromptSubmit", () => {
  it("records a registered consumer as heard from, in a turn, and is silent with nothing new", async () => {
    const r = squealRepo();
    r.apply(r.fail());
    await runHook("session-start", recorded("session-start", r.root), deps({ now: () => 1_000 }));

    const out = await runHook("user-prompt-submit", prompt(r.root), deps({ now: () => 9_000 }));

    expect(out).toEqual(SILENT);
    expect(r.store.consumers.get(r.consumer())?.lastSeenAt).toBe(9_000);
    expect(readTurn(r.store, r.consumer()).turn).toBe("in-turn");
  });

  it("registers on a fresh store and injects the header (review wave 6, S1)", async () => {
    const r = squealRepo();
    r.apply(r.pass());
    const out = await runHook("user-prompt-submit", prompt(r.root), deps());

    expect(r.store.consumers.get(r.consumer())).not.toBeNull();
    expect(JSON.parse(out.stdout)).toEqual({
      hookSpecificOutput: {
        hookEventName: "UserPromptSubmit",
        additionalContext: expect.stringMatching(
          /^SQUEAL · registered at revision 1\n[\s\S]*Known failures: 0\n\nSqueal runs [^\n]*$/,
        ),
      },
    });
  });

  it("re-registers an expired consumer and states the recovery it was not told", async () => {
    const r = squealRepo();
    r.apply(r.pass());
    await runHook("user-prompt-submit", prompt(r.root), deps());
    r.apply(r.fail());
    // Told PASS -> FAIL, then expired while idle; the check recovers before the next prompt.
    const told = await runHook("post-tool-batch", recorded("post-tool-batch", r.root), deps());
    expect(told.stdout).toContain("PASS -> FAIL");
    r.store.consumers.unregister(r.consumer());
    r.apply(r.pass());

    const out = await runHook("user-prompt-submit", prompt(r.root), deps());

    expect(JSON.parse(out.stdout)).toEqual({
      hookSpecificOutput: {
        hookEventName: "UserPromptSubmit",
        additionalContext: expect.stringMatching(
          /^SQUEAL · registered at revision 3\n[\s\S]*Known failures: 0\n\nSqueal runs [^\n]*$/,
        ),
      },
    });
  });

  it("ensures a daemon whose heartbeat is stale before registering", async () => {
    const r = squealRepo();
    r.apply(r.fail());
    r.daemon("stale");
    const ensured: string[] = [];
    await runHook(
      "user-prompt-submit",
      prompt(r.root),
      deps({
        ensureDaemon: async (root) => {
          ensured.push(root);
          return "alive";
        },
      }),
    );
    expect(ensured).toEqual([r.root]);
  });

  it.each([
    ["-p mode", { CLAUDE_CODE_SESSION_ATTENDED: "0", CLAUDE_CODE_ENTRYPOINT: "sdk-cli" }],
    ["no attended flag", { CLAUDE_CODE_ENTRYPOINT: "cli" }],
  ])("registers nothing in %s, where SessionStart and PostToolBatch register", async (_, env) => {
    const r = squealRepo();
    r.apply(r.fail());
    expect(await runHook("user-prompt-submit", prompt(r.root), deps({ env }))).toEqual(SILENT);
    expect(r.store.consumers.get(r.consumer())).toBeNull();
  });

  it("does nothing in a repository without Squeal", async () => {
    const repo = fakeRepo();
    const ensured: string[] = [];
    const out = await runHook(
      "user-prompt-submit",
      prompt(repo.main),
      deps({
        ensureDaemon: async (root) => {
          ensured.push(root);
          return "alive";
        },
      }),
    );
    expect(out).toEqual(SILENT);
    expect(ensured).toEqual([]);
  });
});
