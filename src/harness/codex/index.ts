/** Codex adapter: hook handlers behind the plugin in plugins/codex (spec 002 D2 to D5). Task 002-12. */

export type { CodexHandler } from "./hook.js";
export { CODEX_HOOKS, type CodexHookName, runCodexHook } from "./hooks.js";
export { type CodexHookInput, parseCodexInput } from "./input.js";
export { CONTEXT_CAP_CHARS, capContext } from "./output.js";
export { type CodexHookResult, runCodexHandler } from "./run.js";
