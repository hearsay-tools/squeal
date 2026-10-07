import type { HookLocation } from "../shared/context.js";
import type { HookDeps } from "../shared/hook.js";
import type { CodexHookInput } from "./input.js";

/**
 * One Codex hook: the JSON object to print, or `null` for no output. Every
 * Codex hook exits 0; exit 2 is never used (spec 002 D3).
 */
export type CodexHandler = (
  input: CodexHookInput,
  location: HookLocation,
  deps: HookDeps,
) => Promise<object | null>;
