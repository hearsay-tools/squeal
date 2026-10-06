/** The waiter lock lives in the core, which the daemon's expiry pass shares (task 001-47). */
export {
  acquireWaiterLock,
  removeWaiterLock,
  type WaiterLock,
  waiterLockPath,
} from "../../core/waiter-lock/index.js";
