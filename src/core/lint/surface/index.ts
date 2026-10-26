/**
 * Spec 017 D8: what the agent, status and `squeal lint` are told of lint
 * checks, read from the lint store the pass writes. Every function opens
 * nothing while `lint.enabled` is off (goal 1).
 */

export {
  acknowledgeLint,
  dropLint,
  type LintAck,
  type LintNewsRead,
  readLintNews,
  registerLint,
  tellLint,
} from "./deliver.js";
export {
  lintChanges,
  lintEntryLine,
  lintFailedLine,
  lintLines,
  lintOffLine,
  lintRegistrationLine,
  lintStatusLines,
  lintSummaryLine,
  lintTitleWords,
} from "./format.js";
export { lintChanged, lintDetails, lintStatus, lintStop, wentToFail } from "./report.js";
export {
  type LintAccess,
  type LintRead,
  type LintStoreSource,
  lintStoreSource,
  withLint,
} from "./source.js";
