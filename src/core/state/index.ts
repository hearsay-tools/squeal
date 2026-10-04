/** Known state, fingerprints and transitions, spec 001 D6. Task 001-21. */

export { baselineFindings } from "./baseline.js";
export { checkIdentity, testFileOf } from "./derive.js";
export { describeFailure, SUMMARY_MAX_CHARS } from "./fingerprint.js";
export { createStateSink, type StateSinkOptions } from "./sink.js";
export { type Observation, transitionKind } from "./transitions.js";
