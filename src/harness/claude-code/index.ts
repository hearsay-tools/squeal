/** Claude Code adapter: hook handlers behind the plugin in plugins/claude-code (spec 001 D9). Task 001-31. */

export { waiterLockPath } from "../../core/waiter-lock/index.js";
export { SOCKET_TIMEOUT_MS, SPAWN_SETTLE_MS } from "./ensure.js";
export { HOOK_TIMEOUT_MS, type HookDeps, type HookOutcome } from "./hook.js";
export { STOP_MARGIN_MS, STOP_WAIT_CAP_MS, stopBusyTimeoutMs } from "./hooks/stop.js";
export {
  isInteractive,
  REGISTRATION_GRACE_MS,
  WAITER_HOOK_TIMEOUT_S,
  WAITER_TIMEOUT_MS,
} from "./hooks/waiter.js";
export { HOOKS, type HookName, runHook } from "./hooks.js";
export { type HookResult, runHandler } from "./run.js";
