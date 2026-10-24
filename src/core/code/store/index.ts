/** The code store, spec 015 D4: `code.sqlite` beside the main store, opened only while `complexity.enabled` holds. */

export {
  codeStorePath,
  isCodeStoreOpenFailure,
  type OpenCodeStoreOptions,
  openCodeStore,
} from "./open.js";
export { pruneCodeStoreAfter } from "./prune-main.js";
export { CODE_SCHEMA_VERSION } from "./schema.js";
export type * from "./types.js";
