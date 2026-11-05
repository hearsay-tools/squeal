import { CHECK_MOMENTS } from "../../core/daemon/check-groups.js";
import { readPolicy } from "../../core/daemon/policy.js";
import { groupView } from "../../core/scheduler/slow.js";
import { slowPolicyView } from "../../core/state/index.js";
import {
  type CheckMoment,
  type Policy,
  TESTS_GROUP,
  type TestFileKeyRecord,
} from "../../core/types/index.js";
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
   * `"continuous"` (D8 as amended 2026-10-18, row 004-80: when they run);
   * `maxHolds`, `stop.maxHolds` above 1 (019 D4 step 3, row 019-24: how
   * many times Stop may hold the agent in a turn), absent meaning 1.
   */
  readonly slow: {
    readonly files: number | null;
    readonly requireSlowSuite?: boolean;
    readonly pausesOnly?: boolean;
    readonly maxHolds?: number;
  } | null;
  /** With a `checks` key only (row 019-16): the groups by moment. Absent, the primer is today's. */
  readonly groups?: GroupsCoverage;
}

/**
 * Spec 019 D6 (row 019-16): the check groups at each moment that has any,
 * from soonest to latest, each moment's groups in `checks` order. The
 * default `tests` group is named last at `edit` while it owns a listed file
 * or none is listed; the default `slow` group has the slow sentences.
 */
export interface GroupsCoverage {
  readonly moments: readonly { readonly at: CheckMoment; readonly names: readonly string[] }[];
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
    ...(policy.checks.length === 0 ? {} : { groups: groupsCoverage(policy, listed) }),
    slow:
      view === null
        ? null
        : {
            files:
              keys.length === 0 ? null : listed.filter((row) => view.isSlow(row.testFile)).length,
            requireSlowSuite: policy.stop.requireSlowSuite,
            pausesOnly: policy.slow.trigger === "idle",
            ...(policy.stop.maxHolds > 1 ? { maxHolds: policy.stop.maxHolds } : {}),
          },
  };
}

/** The groups of `policy` by moment (`GroupsCoverage`), the `tests` group by the `listed` rows. */
export function groupsCoverage(
  policy: Policy,
  listed: readonly TestFileKeyRecord[],
): GroupsCoverage {
  const view = groupView(policy);
  const testsOwn =
    listed.length === 0 || listed.some((row) => view.of(row.testFile).name === TESTS_GROUP);
  const moments = CHECK_MOMENTS.flatMap((at) => {
    const names = view.groups
      .filter((group) => group.index !== null && group.at === at)
      .map((group) => group.name);
    if (at === "edit" && testsOwn) names.push(TESTS_GROUP);
    return names.length === 0 ? [] : [{ at, names }];
  });
  return { moments };
}
