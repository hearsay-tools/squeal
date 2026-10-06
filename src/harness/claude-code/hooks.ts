import type { HookDeps } from "./hook.js";
import { postToolBatch } from "./hooks/post-tool-batch.js";
import { preToolUse } from "./hooks/pre-tool-use.js";
import { sessionEnd } from "./hooks/session-end.js";
import { sessionStart } from "./hooks/session-start.js";
import { stop } from "./hooks/stop.js";
import { userPromptSubmit } from "./hooks/user-prompt-submit.js";
import { waiter } from "./hooks/waiter.js";
import { type HookResult, runHandler } from "./run.js";

/**
 * Every hook by bundle name; each bundle under plugins/claude-code/dist/
 * imports only its own handler. SubagentStart uses `session-start` and
 * SubagentStop uses `stop`.
 */
export const HOOKS = {
  "session-start": sessionStart,
  "post-tool-batch": postToolBatch,
  "pre-tool-use": preToolUse,
  stop,
  "session-end": sessionEnd,
  "user-prompt-submit": userPromptSubmit,
  waiter,
} as const;

export type HookName = keyof typeof HOOKS;

/** Runs the hook `name` on its stdin text; see `runHandler`. */
export function runHook(name: HookName, stdin: string, deps: HookDeps): Promise<HookResult> {
  return runHandler(name, HOOKS[name], stdin, deps);
}
