/** Claude Code adapter: hook handlers behind the plugin in plugins/claude-code (spec 001 D9). Task 001-31. */
export type { HookDeps, HookOutcome } from "./hook.js";
export { SOCKET_TIMEOUT_MS } from "./hooks/session-start.js";
export { STOP_WAIT_CAP_MS } from "./hooks/stop.js";
export {
  isInteractive,
  REGISTRATION_GRACE_MS,
  WAITER_HOOK_TIMEOUT_S,
  WAITER_TIMEOUT_MS,
} from "./hooks/waiter.js";
export { HOOKS, type HookName, runHook } from "./hooks.js";
export { type HookResult, runHandler } from "./run.js";
export { waiterLockPath } from "./waiter-lock.js";
