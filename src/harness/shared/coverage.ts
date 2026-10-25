import { readPolicy } from "../../core/daemon/policy.js";
import { slowPolicyView } from "../../core/state/index.js";
import {
  configuredProjects,
  DESCRIPTIONS,
  type RunnerCoverage,
  runnerCoverage,
  UNCONFIGURED,
} from "../../runners/descriptions.js";
import type { HookContext } from "./context.js";

/**
 * What Squeal covers in one worktree, for the primer to list (task 001-234):
 * the runners the daemon builds, read from `squeal.config.json` and the root
 * as the daemon reads them, each runner's part by its description (spec 016
 * D5), and the slow files among the test files the daemon last listed into
 * the store.
 *
 * Review wave 13aa, B2: a key row does not say which runner listed it, and a
 * restarted daemon's previous rows stay until its own listing commits, so no
 * runner's project is named from the rows.
 */
export interface Coverage extends RunnerCoverage {
  /**
   * `null` without slow files declared (spec 004 D1); otherwise how many test
   * files the daemon last listed are slow, `null` while it has listed none,
   * and the policy's `stop.requireSlowSuite`, absent meaning its default,
   * off (D8 as amended 2026-10-16, task 004-62: what "done" requires here);
   * `pausesOnly` under `slow.trigger: "idle"`, absent meaning the default,
   * `"continuous"` (D8 as amended 2026-10-18, row 004-80: when they run).
   */
  readonly slow: {
    readonly files: number | null;
    readonly requireSlowSuite?: boolean;
    readonly pausesOnly?: boolean;
  } | null;
}

/** A repository whose root and files are not read yet: what `PRIMER` says. */
export const DEFAULT_COVERAGE: Coverage = { ...UNCONFIGURED, slow: null };

/** The coverage of the worktree `context` hooks into. One read of its key rows, none of its files. */
export function coverageOf(context: HookContext): Coverage {
  const policy = readPolicy(context.root);
  const keys = context.store.testFileKeys.list(context.consumer.worktreeId);
  const runners = runnerCoverage(policy, context.root);
  const configured = new Set(configuredProjects(policy).map((project) => project.name));
  // A row no runner built here could have listed is not counted: without the fallback, only the configured projects'.
  const fallback = DESCRIPTIONS.some((runner) => runner.fallback && runner.built(runners));
  const listed = fallback ? keys : keys.filter((row) => configured.has(row.testFile.project));
  const view = slowPolicyView(policy);
  return {
    ...runners,
    slow:
      view === null
        ? null
        : {
            files:
              keys.length === 0 ? null : listed.filter((row) => view.isSlow(row.testFile)).length,
            requireSlowSuite: policy.stop.requireSlowSuite,
            pausesOnly: policy.slow.trigger === "idle",
          },
  };
}
