/** Known state, fingerprints and transitions, spec 001 D6. Task 001-21. */

export { baselineFindings } from "./baseline.js";
export { formatCheck, parseCheck } from "./check-name.js";
export { checkIdentity, classify, testFileKeyOf, testFileOf } from "./derive.js";
export { describeFailure, SUMMARY_MAX_CHARS } from "./fingerprint.js";
export { FLAKY_META_KEY, flakyText, readFlakyNotes, recordFlips } from "./flaky.js";
export {
  fullSuiteText,
  isFastPending,
  isPending,
  readHeader,
  runnerPartText,
  toKnownFailure,
} from "./header.js";
export { failureKeysOnce, heldFailure } from "./inherited.js";
export { createStateSink, type StateSinkOptions } from "./sink.js";
export {
  classifySlowFiles,
  readSlowTier,
  type SlowPolicyView,
  slowFilesNotCurrent,
  slowPolicyView,
  worktreeSlowView,
} from "./slow.js";
export { clockText, durationText, slowTierText } from "./slow-text.js";
export { type Observation, transitionKind } from "./transitions.js";
