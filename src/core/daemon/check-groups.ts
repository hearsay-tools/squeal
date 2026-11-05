import { createInputMatcher } from "../keys/glob.js";
import { plural } from "../text.js";
import type {
  CheckGroup,
  CheckMoment,
  CheckRunner,
  GroupCheck,
  GroupSelector,
  Policy,
  ResolvedGroup,
  ResolvedLimits,
} from "../types/index.js";

/*
 * Spec 019 D1, D2: the groups of a policy, in the order that decides
 * ownership, and the group of one check. Pure: nothing here lists files or
 * reads the store. The daemon calls `coverageProblems` once it has listed
 * its checks.
 */

/** D1: the moments from soonest to latest. */
export const CHECK_MOMENTS: readonly CheckMoment[] = ["edit", "pause", "stop", "commit", "manual"];

/**
 * D1, D5: a moment that never comes by itself, so its checks run only when
 * asked: at `commit` a commit asks for the files it changed (D5 step 1); at
 * `manual` nothing but a request does (row 019-47). At either, `squeal run
 * <group>` and `run --all` run them.
 */
export function heldUntilAsked(at: CheckMoment): boolean {
  return at === "commit" || at === "manual";
}

export const CHECK_RUNNERS: readonly CheckRunner[] = ["vitest", "nodeTest", "pytest"];
/** D2: the default groups' names, which no `checks` entry may take. */
export const DEFAULT_GROUP_NAMES: readonly string[] = ["tests", "slow"];

const NO_LIMITS: ResolvedLimits = {
  maxParallel: null,
  maxWorkers: null,
  priority: "normal",
  deferUnderLoad: null,
};

/**
 * D2: `tests`, every test file not marked slow, at `edit`; `slow`, every
 * file marked slow (`slow.include`, `nodeTest[].slow`, `pytest[].slow`),
 * after `tests`, at the moment and with the limits today's `slow` keys give.
 * `stop.requireSlowSuite` makes Stop wait for it; under `slow.trigger:
 * "idle"` that is the moment `stop`, under `"continuous"` it still starts at
 * `edit`, as today.
 */
export function defaultGroups(policy: Policy): readonly [ResolvedGroup, ResolvedGroup] {
  const { slow, stop } = policy;
  const marked = (isSlow: boolean): GroupSelector => ({
    kind: "marked",
    slow: isSlow,
    include: slow.include,
    projects: [
      ...policy.nodeTest
        .filter((p) => p.slow === true)
        .map((p) => ({ runner: "nodeTest", name: p.name }) as const),
      ...policy.pytest
        .filter((p) => p.slow === true)
        .map((p) => ({ runner: "pytest", name: p.name }) as const),
    ],
  });
  const continuous = slow.trigger === "continuous";
  const slowAt: CheckMoment = continuous ? "edit" : stop.requireSlowSuite ? "stop" : "pause";
  return [
    {
      name: "tests",
      index: null,
      at: "edit",
      stopRequires: false,
      after: [],
      quietMs: 0,
      limits: NO_LIMITS,
      select: marked(false),
    },
    {
      name: "slow",
      index: null,
      at: slowAt,
      stopRequires: stop.requireSlowSuite,
      after: ["tests"],
      quietMs: continuous ? slow.quietMs : 0,
      limits: {
        maxParallel: slow.maxParallel,
        maxWorkers: slow.maxWorkers,
        priority: "low",
        deferUnderLoad: { maxLoadPerCpu: slow.maxLoadPerCpu, maxDeferMs: slow.maxDeferMs },
      },
      select: marked(true),
    },
  ];
}

/**
 * The groups of `policy`, as `loadPolicy` returns it: each `checks` entry in
 * its order, then the default `tests` and `slow` groups (D2). The first
 * group that matches a check owns it.
 */
export function resolveGroups(policy: Policy): readonly ResolvedGroup[] {
  return [...policy.checks.map(resolveEntry), ...defaultGroups(policy)];
}

function resolveEntry(group: CheckGroup, index: number): ResolvedGroup {
  const given = group.limits ?? {};
  const defer = given.deferUnderLoad;
  return {
    name: group.name,
    index,
    at: group.at,
    stopRequires: group.at === "stop",
    after: group.after ?? [],
    quietMs: group.quietMs ?? 0,
    limits: {
      maxParallel: given.maxParallel ?? null,
      maxWorkers: given.maxWorkers ?? null,
      priority: given.priority ?? "normal",
      deferUnderLoad:
        defer === undefined
          ? null
          : {
              maxLoadPerCpu: defer.maxLoadPerCpu ?? DEFER_DEFAULTS.maxLoadPerCpu,
              maxDeferMs: defer.maxDeferMs ?? DEFER_DEFAULTS.maxDeferMs,
            },
    },
    select:
      "lint" in group
        ? { kind: "lint", tools: group.lint === true ? null : group.lint }
        : {
            kind: "tests",
            runner: group.runner,
            project: group.project ?? null,
            tests: group.tests ?? null,
          },
  };
}

/** D3: an absent `deferUnderLoad` key takes the default of the `slow` key it replaces (004 D3). */
const DEFER_DEFAULTS = { maxLoadPerCpu: 1, maxDeferMs: 600_000 } as const;

/**
 * The group that owns `check`: the first of `groups` that selects it. A
 * lint check no `checks` entry owns has no group (`null`): lint keeps its
 * own moments (D2, 017 D5 and D7).
 */
export function groupOf(groups: readonly ResolvedGroup[], check: GroupCheck): ResolvedGroup | null {
  return groups.find((group) => selects(group.select, check)) ?? null;
}

/** Whether `selector` picks `check`, whoever owns it. */
export function selects(selector: GroupSelector, check: GroupCheck): boolean {
  switch (selector.kind) {
    case "lint":
      return check.kind === "lint" && (selector.tools?.includes(check.tool) ?? true);
    case "tests":
      return (
        check.kind === "test" &&
        check.runner === selector.runner &&
        (selector.project === null || check.project === selector.project) &&
        (selector.tests === null || matcher(selector.tests)(check.path))
      );
    case "marked":
      return check.kind === "test" && markedSlow(selector, check) === selector.slow;
  }
}

function markedSlow(
  selector: Extract<GroupSelector, { kind: "marked" }>,
  check: Extract<GroupCheck, { kind: "test" }>,
): boolean {
  return (
    selector.projects.some((p) => p.runner === check.runner && p.name === check.project) ||
    matcher(selector.include)(check.path)
  );
}

const matchers = new WeakMap<readonly string[], (path: string) => boolean>();
/** Globs compiled once per list; the loader left out every glob that does not compile. */
function matcher(globs: readonly string[]): (path: string) => boolean {
  let match = matchers.get(globs);
  if (match === undefined) {
    match = createInputMatcher(globs) as (path: string) => boolean;
    matchers.set(globs, match);
  }
  return match;
}

/**
 * D1's problems that need the listed checks, and D2's note, once the daemon
 * has listed `checks`: a `checks` group that selects none of them, one
 * whose every check a group above it owns, and one that owns files marked
 * slow, whose marking then is not used. Default groups have none.
 */
export function coverageProblems(
  groups: readonly ResolvedGroup[],
  checks: readonly GroupCheck[],
): string[] {
  const owners = checks.map((check) => groupOf(groups, check));
  const slow = groups.find((group) => group.index === null && group.name === "slow");
  return groups.flatMap((group) => {
    if (group.index === null) return [];
    const at = `"checks" group "${group.name}"`;
    const selected = checks.flatMap((check, i) =>
      selects(group.select, check) ? [{ check, owner: owners[i] }] : [],
    );
    if (selected.length === 0) return [`${at}: ${selectsNothing(group.select, checks)}`];
    const owned = selected.filter(({ owner }) => owner === group).map(({ check }) => check);
    if (owned.length === 0) {
      const above = [...new Set(selected.map(({ owner }) => `"${owner?.name}"`))];
      const own =
        above.length === 1
          ? `group ${above[0]} above it owns`
          : `groups ${above.join(", ")} above it own`;
      return [`${at} selects only checks ${own}`];
    }
    const marked =
      slow === undefined ? 0 : owned.filter((check) => selects(slow.select, check)).length;
    return marked === 0
      ? []
      : [`${at} owns ${plural(marked, "test file")} marked slow; their slow marking is not used`];
  });
}

function selectsNothing(selector: GroupSelector, checks: readonly GroupCheck[]): string {
  if (selector.kind !== "tests" || selector.project === null) return "it selects no check";
  const { runner, project } = selector;
  const known = checks.some(
    (c) => c.kind === "test" && c.runner === runner && c.project === project,
  );
  return known ? "it selects no check" : `"project" names no ${runner} project "${project}"`;
}
