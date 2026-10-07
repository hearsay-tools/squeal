import { describe, expect, it } from "vitest";
import { readTurn } from "../../../src/core/delivery/turn.js";
import { type Consumer, MAIN_AGENT } from "../../../src/core/types/index.js";
import {
  CODEX_HOOKS,
  type CodexHookName,
  type CodexHookResult,
  runCodexHook,
} from "../../../src/harness/codex/index.js";
import type { HookDeps } from "../../../src/harness/shared/hook.js";
import { type SquealRepo, squealRepo } from "../helpers.js";
import { codexInput, codexRecorded } from "./helpers.js";

/*
 * Spec 002 D2 as amended (`lessons.md` defect 2): an inline `/review` thread
 * runs under the main agent's `session_id` with no `agent_id`, and only its
 * `transcript_path` tells it apart. It is not a consumer, so it never takes,
 * marks or blocks on the main agent's reports. Recorded in n4inline2
 * (test/fixtures/codex-hooks/review).
 */

const SILENT: CodexHookResult = { stdout: "", stderr: "" };

/** Hook deps whose daemon ensure counts its calls. */
function counted(): { deps: HookDeps; ensures: () => number } {
  let n = 0;
  return {
    deps: {
      env: {},
      ensureDaemon: async () => {
        n++;
        return "alive";
      },
    },
    ensures: () => n,
  };
}

const hook = (r: SquealRepo, name: CodexHookName, fixture: string, deps: HookDeps, o = {}) =>
  runCodexHook(name, codexRecorded("review", fixture, r.root, o), deps);

const SESSION = String(codexInput("review", "session-start", "/").session_id);
const main = (r: SquealRepo): Consumer => ({
  worktreeId: r.worktreeId,
  sessionId: SESSION,
  agentId: MAIN_AGENT,
});

/** The main thread registered and in a turn, then a `PASS -> FAIL` it was not told. */
async function regressed(deps: HookDeps): Promise<SquealRepo> {
  const r = squealRepo();
  r.apply(r.pass());
  expect(await hook(r, "session-start", "session-start", deps)).not.toEqual(SILENT);
  await hook(r, "user-prompt-submit", "user-prompt-submit", deps);
  r.apply(r.fail());
  return r;
}

/** What the review thread's hooks must leave as they found it. */
const snapshot = (r: SquealRepo) => ({
  consumers: r.store.consumers.list(r.worktreeId),
  turn: readTurn(r.store, main(r)),
});

describe("an inline /review thread (D2 as amended)", () => {
  it("leaves the main agent's regression undelivered for its next PostToolUse", async () => {
    const { deps } = counted();
    const r = await regressed(deps);
    const before = snapshot(r);
    expect(await hook(r, "user-prompt-submit", "review-user-prompt-submit", deps)).toEqual(SILENT);
    expect(await hook(r, "pre-tool-use", "review-pre-tool-use", deps)).toEqual(SILENT);
    const patch = { tool_name: "apply_patch" };
    expect(await hook(r, "pre-tool-use", "review-pre-tool-use", deps, patch)).toEqual(SILENT);
    expect(await hook(r, "post-tool-use", "review-post-tool-use", deps)).toEqual(SILENT);
    expect(snapshot(r)).toEqual(before);

    const out = await hook(r, "post-tool-use", "post-tool-use", deps);
    expect(JSON.parse(out.stdout)).toEqual({
      hookSpecificOutput: {
        hookEventName: "PostToolUse",
        additionalContext: expect.stringMatching(
          /^SQUEAL · 1 check changed at revision 2\n[\s\S]*PASS -> FAIL/,
        ),
      },
    });
  });

  it.each(Object.keys(CODEX_HOOKS) as CodexHookName[])(
    "%s says nothing, ensures no daemon and changes no store",
    async (name) => {
      const { deps, ensures } = counted();
      const r = await regressed(deps);
      const before = { ...snapshot(r), ensures: ensures() };
      // Fields a Stop and a SessionStart would carry; every other hook ignores them.
      const fields = { stop_hook_active: false, source: "startup" };
      expect(await hook(r, name, "review-post-tool-use", deps, fields)).toEqual(SILENT);
      expect({ ...snapshot(r), ensures: ensures() }).toEqual(before);
      expect(
        (await hook(r, "user-prompt-submit", "user-prompt-submit-after-review", deps)).stdout,
      ).toContain("PASS -> FAIL");
    },
  );

  it("serves a main-thread input with no transcript_path as before", async () => {
    const { deps } = counted();
    const r = await regressed(deps);
    const out = await hook(r, "post-tool-use", "post-tool-use", deps, {
      transcript_path: undefined,
    });
    expect(out.stdout).toContain("PASS -> FAIL");
  });
});
