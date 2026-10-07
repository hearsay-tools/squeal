import type { HookDeps } from "../shared/hook.js";
import {
  interrupt,
  postToolUse,
  preToolUse,
  sessionEnd,
  sessionStart,
  stop,
  subagentStart,
  subagentStop,
  userPromptSubmit,
} from "./handlers.js";
import { type CodexHookResult, runCodexHandler } from "./run.js";

/**
 * Every Codex hook by bundle name, one per event: the entries of the wave-1
 * contract between 002-12 and 002-13, which `plugins/codex/hooks/hooks.json`
 * names as `dist/<name>.mjs`.
 */
export const CODEX_HOOKS = {
  "session-start": sessionStart,
  "user-prompt-submit": userPromptSubmit,
  "pre-tool-use": preToolUse,
  "post-tool-use": postToolUse,
  stop,
  "subagent-start": subagentStart,
  "subagent-stop": subagentStop,
  interrupt,
  "session-end": sessionEnd,
} as const;

export type CodexHookName = keyof typeof CODEX_HOOKS;

/** Runs the Codex hook `name` on its stdin text; see `runCodexHandler`. */
export function runCodexHook(
  name: CodexHookName,
  stdin: string,
  deps: HookDeps,
): Promise<CodexHookResult> {
  return runCodexHandler(name, CODEX_HOOKS[name], stdin, deps);
}
