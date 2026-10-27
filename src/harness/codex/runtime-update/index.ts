/*
 * Row 002-34 (spec 002 D8, `wave-5-contract.md`): the Codex runtime updater.
 * The CLI's `codex-runtime update`, `squeal update` and the SessionStart
 * trigger reach it through this module.
 */

export { acquireLock, type LockAttempt, STALE_LOCK_MS, type UpdateLock } from "./lock.js";
export { isAdapterRoot, lockFile, STAGED_PREFIX, stagingDir, updateStateFile } from "./paths.js";
export {
  CHECK_INTERVAL_MS,
  FAILURE_RETRY_MS,
  isDue,
  readUpdateState,
  TRANSIENT_RETRY_MS,
  type UpdateFailure,
  type UpdateState,
} from "./state.js";
export {
  failureOf,
  type RuntimeUpdateOptions,
  type RuntimeUpdateResult,
  selectedRuntime,
  updateRuntime,
} from "./update.js";
