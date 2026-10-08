import { slowFiles, slowGlobs } from "../slow/index.js";
import type { Policy, TestFileRef } from "../types/index.js";

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
