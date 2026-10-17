import { slowFiles, slowGlobs } from "../slow/index.js";
import { type Policy, SLOW_LANE_PREFIX, type TestFileRef } from "../types/index.js";

/** Spec 004 D1 under one policy: which test files are slow, and the globs that say so (D6). */
export interface SlowView {
  readonly isSlow: (ref: TestFileRef) => boolean;
  readonly globs: readonly string[];
  /** Some file can be slow: `slow.include` or a slow node:test project. */
  readonly declared: boolean;
}

const views = new WeakMap<Policy, SlowView>();

/** The view of `policy`, compiled once per policy object; a reload replaces the object. */
export function slowView(policy: Policy): SlowView {
  let view = views.get(policy);
  if (view === undefined) {
    const globs = slowGlobs(policy, policy.nodeTest);
    view = { isSlow: slowFiles(policy, policy.nodeTest), globs, declared: globs.length > 0 };
    views.set(policy, view);
  }
  return view;
}

/**
 * The lane of `ref` given its runner's lane (`RunnerAdapter.lane`, `""` for a
 * runner that names none): a slow file's is its runner's behind
 * `SLOW_LANE_PREFIX` (spec 004 D2, task 004-18). Pure, so status names the
 * lane the scheduler picks (task 011-12).
 */
export function laneFor(policy: Policy, ref: TestFileRef, runnerLane: string): string {
  return slowView(policy).isSlow(ref) ? SLOW_LANE_PREFIX + runnerLane : runnerLane;
}
