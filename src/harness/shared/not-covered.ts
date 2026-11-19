import { DESCRIPTIONS, type RunnerCoverage } from "../../runners/descriptions.js";

/*
 * What Squeal does not run, the sentence `squeal checks` ends with (row
 * 005-126). The start message said it until row 005-128.
 */

/**
 * Task 001-234: what Squeal does not cover, always whole; spec 004 D8 as
 * amended 2026-10-18 (task 004-81): with the test files each runner's
 * excludes drop named, as its description names them.
 */
export function notCovered(coverage: RunnerCoverage): string {
  const files = DESCRIPTIONS.flatMap((runner) => runner.excluded(coverage) ?? []);
  const what =
    files.length === 0
      ? "typecheck, build"
      : `typecheck, build, the ${files.join(", the ")}, which squeal.config.json excludes,`;
  return `Squeal does not cover ${what} or any other test suite: run those yourself.`;
}
