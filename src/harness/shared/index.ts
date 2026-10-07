/**
 * Harness-neutral hook logic (spec 002 D5): what reads the store, the
 * delivery interface, the daemon-ensuring helper or the turn state. Each
 * harness adapter parses its own stdin, writes its own output shapes and
 * reads its own environment around these. Task 002-10.
 */

export {
  type ConsumerInput,
  type ContextOptions,
  type HookContext,
  type HookLocation,
  locate,
  openContext,
  usesSqueal,
} from "./context.js";
export { deliver, mayEdit } from "./deliver.js";
export { denyOnRegression } from "./deny.js";
export { ensure, ensureIfStale, SOCKET_TIMEOUT_MS, SPAWN_SETTLE_MS, settle } from "./ensure.js";
export { HOOK_TIMEOUT_MS, type HookDeps, isRegistered, withContext } from "./hook.js";
export { PRIMER, withPrimer } from "./primer.js";
export { submitPrompt } from "./prompt.js";
export { endSession, startSession } from "./session.js";
export {
  STOP_MARGIN_MS,
  STOP_POLL_MS,
  STOP_WAIT_CAP_MS,
  type StopOutcome,
  stopBusyTimeoutMs,
  stopFork,
  stopTurn,
} from "./stop.js";
export { unregisterSession } from "./sweep.js";
export {
  denialSentence,
  fullSuiteReason,
  knownFailuresLine,
  knownFailuresReason,
  statusText,
} from "./text.js";
export { REGISTRATION_GRACE_MS, waitIdle } from "./waiter.js";
