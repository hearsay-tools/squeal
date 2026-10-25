/** Shared store, spec 001 D1 and D8. Task 001-10. */

export { BUSY_SLICE_MS, BusyWaits, busyBackoffMs, busyNote } from "./busy.js";
export { isBusy, withBusySlice, withBusySliceSync } from "./connection.js";
export {
  DEFAULT_BUSY_TIMEOUT_MS,
  type IntegrityCheck,
  isCorruption,
  isStoreOpenFailure,
  META_FULL_CHECK,
  META_STORE_RECOVERED,
  markStore,
  type OpenStoreOptions,
  openStore,
  readStoreMark,
  type StoreMark,
  setBusyTimeout,
} from "./open.js";
export { lockFileFor, type StorePaths, storePaths } from "./paths.js";
export { SCHEMA_VERSION } from "./schema.js";
export { type ChangeMarker, changeMarker, readTransaction } from "./store.js";
