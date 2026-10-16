/** `squeal status` and `squeal why`, spec 001 D7. Task 001-22. */

export {
  IGNORED_READS_CAP,
  type IgnoredReads,
  type IgnoredReadsOfFile,
  readIgnoredReads,
} from "../scheduler/ignored-reads.js";
export { formatCheck, parseCheck } from "../state/index.js";
export {
  type CheckCounts,
  checkPartsText,
  countChecks,
  countedText,
  failureCountText,
} from "./checks.js";
export {
  FAILURES_LIMIT,
  type FailuresOptions,
  formatFailures,
  readFailures,
} from "./failures.js";
export { formatStatus, formatUnavailable } from "./format-status.js";
export { formatWhy } from "./format-why.js";
export {
  CLI_READ_RETRY_MS,
  STATUS_BUSY_TIMEOUT_MS,
  type StatusContext,
  type StatusStoreOptions,
  withStatusStore,
} from "./open.js";
export { WHY_LOG_LINE_LIMIT } from "./run-log.js";
export {
  buildSnapshot,
  createStatusBuilder,
  HEARTBEAT_GRACE_INTERVALS,
  readStatus,
  type StatusBuilderOptions,
  type StatusOptions,
} from "./snapshot.js";
export { UNKNOWN_FILES_LISTED, unknownFileText } from "./unknown-files.js";
export {
  readWhy,
  WHY_CANDIDATE_LIMIT,
  WHY_CHANGED_LIMIT,
  WHY_RESULT_LIMIT,
  type WhyOptions,
} from "./why.js";
