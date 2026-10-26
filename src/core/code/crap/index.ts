/** Spec 015 D9: CRAP and "no in-process test that Squeal runs reaches it", from 015-11's records. */

export { StepCache } from "./cache.js";
export {
  ALL_CHECKS,
  applyChecks,
  type CoverageChecks,
  coverageChecks,
  sameChecks,
} from "./checks.js";
export { coverageOf, type FileCondition, type FunctionCoverage, fileCondition } from "./file.js";
export { type JoinedFunction, joinCoverage } from "./join.js";
export {
  BUSY_RECHECK_MS,
  type Loader,
  LoaderBuild,
  type LoaderCondition,
  type LoaderInputs,
  type Loaders,
  type PendingReason,
  RECORD_WAIT_MS,
  type UnknownCause,
} from "./loaders.js";
export { clearCoverage, removedFailures } from "./removed.js";
export { crapScore, FULL_COVERAGE } from "./score.js";
export { COVERAGE_MEASURES, SEED_FILES } from "./seed.js";
export {
  type CoverageStepInput,
  type CoverageStepReport,
  runCoverageStep,
  STEP_BUDGET_MS,
} from "./step.js";
export * from "./summary.js";
