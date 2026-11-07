import type { CheckGroup, CheckMoment } from "../types/check-groups.js";
import type { Policy } from "../types/policy.js";
import { CHECK_MOMENTS, defaultGroups } from "./check-groups.js";

/*
 * Spec 019 D1's problems that need more than one entry: a `project` the
 * runner does not have, a lint tool `lint.tools` does not run, and `after`
 * (a lint group named there is one too, row 019-45).
 * Run once the whole file is merged, over the groups the `checks` leaf kept;
 * a group is named by its name, unique by then. A group left out here can
 * leave out a group whose `after` names it, so `after` is settled to a
 * fixed point.
 */

/** The groups kept, in their order, and one problem per group left out. */
export interface SettledChecks {
  readonly checks: readonly CheckGroup[];
  readonly problems: readonly string[];
}

export function settleChecks(policy: Policy): SettledChecks {
  const why = new Map<CheckGroup, string>();
  for (const group of policy.checks) {
    const problem = keyProblem(policy, group);
    if (problem !== null) why.set(group, problem);
  }
  const defaults = new Map(defaultGroups(policy).map((group) => [group.name, group.at]));
  for (let changed = true; changed; ) {
    const alive = policy.checks.filter((group) => !why.has(group));
    const byName = new Map(alive.map((group) => [group.name, group]));
    const found = new Map<CheckGroup, string>();
    for (const group of alive) {
      const problem =
        afterProblem(group, byName, defaults, policy.checks) ?? cycleOf(group, byName);
      if (problem !== null) found.set(group, problem);
    }
    for (const [group, problem] of found) why.set(group, problem);
    changed = found.size > 0;
  }
  return {
    checks: policy.checks.filter((group) => !why.has(group)),
    problems: policy.checks.flatMap((group) => {
      const problem = why.get(group);
      return problem === undefined
        ? []
        : [`"checks" group "${group.name}": ${problem}; it is left out`];
    }),
  };
}

function keyProblem(policy: Policy, group: CheckGroup): string | null {
  if ("lint" in group) {
    if (group.lint === true) return null;
    const missing = group.lint.find((tool) => !policy.lint.tools.includes(tool));
    return missing === undefined
      ? null
      : `"lint" names "${missing}", which "lint.tools" does not run`;
  }
  // A Vitest project is known only once the daemon reads the Vitest config: `coverageProblems`.
  if (group.project === undefined || group.runner === "vitest") return null;
  const projects = group.runner === "nodeTest" ? policy.nodeTest : policy.pytest;
  return projects.some((project) => project.name === group.project)
    ? null
    : `"project" names no ${group.runner} project "${group.project}"`;
}

function afterProblem(
  group: CheckGroup,
  byName: ReadonlyMap<string, CheckGroup>,
  defaults: ReadonlyMap<string, CheckMoment>,
  all: readonly CheckGroup[],
): string | null {
  for (const name of group.after ?? []) {
    const named = byName.get(name);
    // Row 019-45: a lint group has no lane, so nothing would ever wait for it.
    if (named !== undefined && "lint" in named) {
      return `"after" names "${name}", a lint group; a group follows test groups only`;
    }
    const at = named?.at ?? defaults.get(name);
    if (at === undefined) {
      return all.some((other) => other.name === name)
        ? `"after" names "${name}", a group that is left out`
        : `"after" names no group "${name}"`;
    }
    if (CHECK_MOMENTS.indexOf(at) > CHECK_MOMENTS.indexOf(group.at)) {
      return `"after" names "${name}", a group at "${at}", later than its own "${group.at}"`;
    }
  }
  return null;
}

/** A cycle through `group` by `after` among `byName`, as text; the default groups are in none. */
function cycleOf(group: CheckGroup, byName: ReadonlyMap<string, CheckGroup>): string | null {
  const seen = new Set<string>();
  const paths: string[][] = [[group.name]];
  for (let path = paths.pop(); path !== undefined; path = paths.pop()) {
    for (const next of byName.get(path.at(-1) as string)?.after ?? []) {
      if (next === group.name) return `"after" makes a cycle (${[...path, next].join(" after ")})`;
      if (seen.has(next) || !byName.has(next)) continue;
      seen.add(next);
      paths.push([...path, next]);
    }
  }
  return null;
}
