/** Shared store, spec 001 D1 and D8. Task 001-10. */
export {
  DEFAULT_BUSY_TIMEOUT_MS,
  isStoreOpenFailure,
  META_STORE_RECOVERED,
  type OpenStoreOptions,
  openStore,
} from "./open.js";
export {
  lockFileFor,
  resolveCommonDir,
  type StorePaths,
  storePaths,
  worktreeIdFor,
} from "./paths.js";
export { SCHEMA_VERSION } from "./schema.js";
