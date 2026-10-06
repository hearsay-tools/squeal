/**
 * The idle waiter's per-consumer lock (spec 001 D9). Hooks hold it while a
 * waiter runs; the daemon's expiry pass (D10) reads it as the interactive
 * main agent's liveness. Task 001-47.
 */
export {
  acquireWaiterLock,
  removeWaiterLock,
  type WaiterLock,
  type WaiterLockState,
  waiterLockPath,
  waiterLockState,
} from "./waiter-lock.js";
