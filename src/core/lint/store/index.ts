/** The lint store, spec 017 D6: `lint.sqlite` beside the main store, opened only while `lint.enabled` holds. */

export {
  isLintStoreOpenFailure,
  lintStorePath,
  type OpenLintStoreOptions,
  openLintStore,
} from "./open.js";
export { LINT_SCHEMA_VERSION } from "./schema.js";
export type * from "./types.js";
