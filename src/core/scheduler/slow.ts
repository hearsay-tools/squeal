import { groupOf, resolveGroups } from "../daemon/check-groups.js";
import { testFileId } from "../keys/reverse-index.js";
import { slowGlobs } from "../slow/classify.js";
import type { CheckRunner, ResolvedGroup } from "../types/check-groups.js";
import type { ProjectName } from "../types/common.js";
import type { TestFileRef } from "../types/keys.js";
import type { Policy } from "../types/policy.js";
import { groupLane, TESTS_GROUP } from "../types/scheduler.js";

/**
 * Spec 019 D1, D2 under one policy: its groups in ownership order, and the
 * group that owns a test file (019-07's `groupOf`). A test file always has
 * one: the default `tests` and `slow` groups between them select every file.
 */
export interface GroupView {
  readonly groups: readonly ResolvedGroup[];
  readonly of: (ref: TestFileRef) => ResolvedGroup;
}

const groupViews = new WeakMap<Policy, GroupView>();

/** The view of `policy`, compiled once per policy object; a reload replaces the object. */
export function groupView(policy: Policy): GroupView {
  let view = groupViews.get(policy);
  if (view === undefined) {
    const groups = resolveGroups(policy);
    const owners = new Map<string, ResolvedGroup>();
    const of = (ref: TestFileRef): ResolvedGroup => {
      const id = testFileId(ref);
      let owner = owners.get(id);
      if (owner === undefined) {
        const check = { kind: "test", runner: runnerOf(policy, ref.project), ...ref } as const;
        owner = groupOf(groups, check) ?? fallback(groups);
        owners.set(id, owner);
      }
      return owner;
    };
    view = { groups, of };
    groupViews.set(policy, view);
  }
  return view;
}

/** The default `tests` group: never reached, since the default groups select every test file. */
function fallback(groups: readonly ResolvedGroup[]): ResolvedGroup {
  const tests = groups.find((group) => group.index === null && group.name === TESTS_GROUP);
  if (tests === undefined) throw new Error("the default tests group is missing");
  return tests;
}

/**
 * The runner of `project` by its `squeal.config.json` key: a `nodeTest` or
 * `pytest` entry's name, else a Vitest project (names are unique across
 * runners, spec 003 D7).
 */
export function runnerOf(policy: Policy, project: ProjectName): CheckRunner {
  if (policy.nodeTest.some((p) => p.name === project)) return "nodeTest";
  if (policy.pytest.some((p) => p.name === project)) return "pytest";
  return "vitest";
}

/** Spec 004 D1 under one policy: which test files are slow, and the globs that say so (D6). */
export interface SlowView {
  /**
   * A group other than `tests` owns the file (spec 019 D3): it runs in a
   * group lane. With no `checks` key, a file spec 004 D1 marks slow.
   */
  readonly isSlow: (ref: TestFileRef) => boolean;
  readonly globs: readonly string[];
  /** Some file can be slow: `slow.include`, a slow node:test or pytest entry. */
  readonly declared: boolean;
}

const views = new WeakMap<Policy, SlowView>();

/** The view of `policy`, compiled once per policy object; a reload replaces the object. */
export function slowView(policy: Policy): SlowView {
  let view = views.get(policy);
  if (view === undefined) {
    const globs = slowGlobs(policy, policy.nodeTest);
    const groups = groupView(policy);
    view = {
      isSlow: (ref) => groups.of(ref).name !== TESTS_GROUP,
      globs,
      declared: globs.length > 0,
    };
    views.set(policy, view);
  }
  return view;
}

/**
 * The lane of `ref` given its runner's lane (`RunnerAdapter.lane`, `""` for a
 * runner that names none): its group's (`groupLane`). A default `tests`
 * file's is its runner's, a default `slow` file's is its runner's behind
 * `SLOW_LANE_PREFIX` (spec 004 D2, task 004-18), a configured group's is
 * behind `group:<name>:` (spec 019 D3). Pure, so status names the lane the
 * scheduler picks (task 011-12).
 */
export function laneFor(policy: Policy, ref: TestFileRef, runnerLane: string): string {
  return groupLane(groupView(policy).of(ref).name, runnerLane);
}
