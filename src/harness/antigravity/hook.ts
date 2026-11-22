import type { HookLocation } from "../shared/context.js";
import type { HookDeps } from "../shared/hook.js";
import type { AntigravityHookInput } from "./input.js";

/**
 * One Antigravity hook: the JSON object to print, or `null` for empty stdout.
 * Every Antigravity hook exits 0, and never prints `{}` (spec 024 D3).
 */
export type AntigravityHandler = (
  input: AntigravityHookInput,
  location: HookLocation,
  deps: HookDeps,
) => Promise<object | null>;
