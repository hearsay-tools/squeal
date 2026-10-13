import { describe, expect, it } from "vitest";
import { testCommandDenied } from "../../../src/core/delivery/test-command-denied.js";
import { omittedTestFilesMetaKey } from "../../../src/core/scheduler/omitted-test-files.js";
import { runCodexHook } from "../../../src/harness/codex/index.js";
import type { HookDeps } from "../../../src/harness/shared/hook.js";
import { squealRepo } from "../helpers.js";
import { codexRecorded, sessionOf } from "./helpers.js";

/* Spec 005 D8 in Codex: the same one-time deny, from the `Bash` call's `tool_input.command`. */

const command = 'node "/opt/codex/plugins/squeal/dist/cli/squeal.mjs"';
const deps: HookDeps = { env: {}, ensureDaemon: async () => "alive", command };
const IN_SESSION = sessionOf("exec", "session-start");

describe("the one-time test-command deny in Codex (spec 005 D8)", () => {
  it("denies the first answered test command once, and is off by default", async () => {
    const r = squealRepo();
    r.store.meta.set(omittedTestFilesMetaKey(r.worktreeId), "0");
    r.apply(r.pass());
    await runCodexHook("session-start", codexRecorded("exec", "session-start", r.root), deps);
    const bash = (text: string) =>
      runCodexHook(
        "pre-tool-use",
        codexRecorded("exec", "pre-tool-use", r.root, {
          ...IN_SESSION,
          tool_input: { command: text },
        }),
        deps,
      );

    expect((await bash("npx vitest run")).stdout).toBe("");
    r.policy({ testCommand: { denyWhenCurrent: true } });
    expect((await bash("ls")).stdout).toBe("");

    const denied = JSON.parse((await bash("npx vitest run")).stdout) as {
      hookSpecificOutput: { permissionDecision: string; permissionDecisionReason: string };
    };
    expect(denied.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(denied.hookSpecificOutput.permissionDecisionReason).toMatch(
      /^The command did not run\. Squeal holds current results at revision 1 for the 1 test file it runs \(src\/math\.test\.ts\)/,
    );
    const consumer = r.store.consumers.list(r.worktreeId)[0]?.consumer;
    expect(consumer !== undefined && testCommandDenied(r.store, consumer)).toBe(true);
    expect((await bash("npx vitest run")).stdout).toBe("");
  });
});
