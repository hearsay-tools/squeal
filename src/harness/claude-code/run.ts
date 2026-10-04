import { locate } from "./context.js";
import type { Handler, HookDeps } from "./hook.js";
import { postToolBatch } from "./hooks/post-tool-batch.js";
import { preToolUse } from "./hooks/pre-tool-use.js";
import { sessionEnd } from "./hooks/session-end.js";
import { sessionStart } from "./hooks/session-start.js";
import { stop } from "./hooks/stop.js";
import { waiter } from "./hooks/waiter.js";
import { parseHookInput } from "./input.js";

/**
 * Hook entry points; one bundle each under plugins/claude-code/dist/.
 * SubagentStart uses `session-start` and SubagentStop uses `stop`.
 */
export const HOOKS = {
  "session-start": sessionStart,
  "post-tool-batch": postToolBatch,
  "pre-tool-use": preToolUse,
  stop,
  "session-end": sessionEnd,
  waiter,
} satisfies Record<string, Handler>;

export type HookName = keyof typeof HOOKS;

export interface HookResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: 0 | 2;
}

const SILENT: HookResult = { stdout: "", stderr: "", exitCode: 0 };

/**
 * Runs one hook on its stdin text. Spec 001 D9: every hook "exits 0 with no
 * output on any internal error". Malformed input, a cwd outside any git
 * worktree, a missing or unreadable store and every thrown error end silent.
 * `SQUEAL_HOOK_DEBUG=1` reports the swallowed error on stderr, which Claude
 * Code does not show the model after exit 0.
 */
export async function runHook(name: HookName, stdin: string, deps: HookDeps): Promise<HookResult> {
  try {
    const input = parseHookInput(stdin);
    if (input === null) return SILENT;
    const location = locate(input.cwd);
    if (location === null) return SILENT;
    const outcome = await HOOKS[name](input, location, deps);
    if (outcome === null) return SILENT;
    return {
      stdout: outcome.output === undefined ? "" : JSON.stringify(outcome.output),
      stderr: outcome.stderr ?? "",
      exitCode: outcome.exitCode ?? 0,
    };
  } catch (error) {
    if (deps.env.SQUEAL_HOOK_DEBUG === "1") {
      return { ...SILENT, stderr: `squeal ${name} hook: ${String(error)}\n` };
    }
    return SILENT;
  }
}
