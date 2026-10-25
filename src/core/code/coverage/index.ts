/** Spec 015 D8: coverage from Squeal's own Vitest runs, one record per test file result. */

export { mapScript } from "./map.js";
export { Pace } from "./pace.js";
export {
  buildRecord,
  COVERAGE_PROVIDER_VERSION,
  decodeRecord,
  encodeRecord,
  hasLine,
} from "./record.js";
export {
  coverageOn,
  coverageProvider,
  mainStoreResultKey,
  PROVIDER_FILE,
  PROVIDER_MISSING_NOTE,
} from "./runtime.js";
export type * from "./types.js";
export {
  type CoverageWriter,
  type CoverageWriterOptions,
  createCoverageWriter,
  RESULT_WAITS_MS,
} from "./writer.js";
