// Throwaway probe for research/ci-evidence.md, Q2. Bundled with esbuild to a
// CommonJS file that the probe hook requires inside the project's Vitest
// process, as a product hook bundled into dist/ci/ would. Not product code.
export { blobHash } from "../../../../../../src/core/hash/blob.js";
export { shareRecord } from "../../../../../../src/core/code/coverage/parts.js";
export {
  buildRecord,
  COVERAGE_PROVIDER_VERSION,
  COVERAGE_RECORD_VERSION,
  encodeRecord,
} from "../../../../../../src/core/code/coverage/record.js";
