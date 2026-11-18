import { DESCRIPTIONS } from "../../runners/descriptions.js";
import type { Coverage } from "./coverage.js";

/*
 * The primer's last sentence, on its own so `squeal checks` ends with it
 * (row 005-126) without bundling the primer into the CLI.
 */

/**
 * Task 001-234: what Squeal does not cover, always whole; spec 004 D8 as
 * amended 2026-10-18 (task 004-81): with the test files each runner's
 * excludes drop named, as its description names them.
 */
export function notCovered(coverage: Coverage): string {
  const files = DESCRIPTIONS.flatMap((runner) => runner.excluded(coverage) ?? []);
  const what =
    files.length === 0
      ? "typecheck, build"
      : `typecheck, build, the ${files.join(", the ")}, which squeal.config.json excludes,`;
  return `Squeal does not cover ${what} or any other test suite: run those yourself.`;
}
