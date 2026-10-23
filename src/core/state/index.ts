/** Known state, fingerprints and transitions, spec 001 D6. Task 001-21. */

export { baselineFindings } from "./baseline.js";
export { beforeEditsFor, recordRegisteredKeys, registeredKeysMetaKey } from "./before-edits.js";
export { formatCheck, parseCheck } from "./check-name.js";
export {
  checkIdentity,
  classify,
  firstOfEachCheck,
  testFileKeyOf,
  testFileOf,
} from "./derive.js";
export { type FileClass, fileClassOf } from "./file-class.js";
export {
  causeText,
  describeFailure,
  SUMMARY_MAX_CHARS,
  sameFingerprint,
  withCode,
} from "./fingerprint.js";
export { FLAKY_KEPT, FLAKY_META_KEY, flakyText, readFlakyNotes, recordFlips } from "./flaky.js";
export {
  fullSuiteText,
  isFastPending,
  isPending,
  readHeader,
  runnerPartText,
  toKnownFailure,
} from "./header.js";
export { failureKeysOnce, heldFailure } from "./inherited.js";
export {
  FAILURE_PRODUCERS_KEPT,
  type FailureProducer,
  failureProducersMetaKey,
  producingResult,
  readFailureProducers,
  recordFailureProducers,
} from "./producers.js";
export {
  RERUN_FIRST_KEPT,
  RERUN_FIRST_META_KEY,
  readRerunFirstFailures,
  recordRerunFirstFailures,
} from "./rerun-first.js";
export { readRevisionCommit, revisionText } from "./revision-commit.js";
export { observedSince, shownResult } from "./shown-result.js";
export { createStateSink, type StateSinkOptions } from "./sink.js";
export {
  classifySlowFiles,
  readSlowTier,
  type SlowPolicyView,
  slowFilesNotCurrent,
  slowPolicyView,
  worktreeSlowView,
} from "./slow.js";
export {
  clockText,
  durationText,
  slowAffectedText,
  slowTierText,
  slowWaitText,
} from "./slow-text.js";
export { type Observation, transitionKind } from "./transitions.js";
