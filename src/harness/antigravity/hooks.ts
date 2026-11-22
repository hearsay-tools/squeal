import type { HookDeps } from "../shared/hook.js";
import { preInvocation, preToolUse, sessionStart, stop, stopSlowTier } from "./handlers.js";
import { type AntigravityHookResult, runAntigravityHandler } from "./run.js";

/**
 * Every Antigravity hook by bundle name: the entries `plugins/antigravity/hooks.json`
 * names as `dist/<name>.mjs` (spec 024 D3).
 */
export const ANTIGRAVITY_HOOKS = {
  "session-start": sessionStart,
  "pre-invocation": preInvocation,
  "pre-tool-use": preToolUse,
  stop,
  "stop-slow": stopSlowTier,
} as const;

export type AntigravityHookName = keyof typeof ANTIGRAVITY_HOOKS;

/** Runs the Antigravity hook `name` on its stdin text; see `runAntigravityHandler`. */
export function runAntigravityHook(
  name: AntigravityHookName,
  stdin: string,
  deps: HookDeps,
): Promise<AntigravityHookResult> {
  return runAntigravityHandler(name, ANTIGRAVITY_HOOKS[name], stdin, deps);
}
