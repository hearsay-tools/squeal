import { posix } from "node:path";
import { createInputMatcher } from "../keys/glob.js";
import type { ProjectName } from "../types/common.js";
import type { TestFileRef } from "../types/keys.js";
import type { NodeTestProject, Policy } from "../types/policy.js";

/** What marks a runner entry's files slow (spec 004 D1, 007 D1): a `nodeTest` or `pytest` entry. */
type Marking = Pick<NodeTestProject, "name" | "cwd" | "include" | "slow">;

/**
 * Spec 004 D1: which test files are slow. A file is slow when its
 * worktree-relative path matches a `slow.include` glob, whatever its runner,
 * or when its project is one of `projects` or of `policy.pytest` marked
 * `slow: true` (007 D1: "an entry's `slow: true` marks all of them"; row
 * 019-10). `projects` are the node:test projects the daemon runs, normally
 * `policy.nodeTest`; project names are unique across runners (spec 003 D7),
 * so the name is enough. The loader has left out every glob that does not
 * compile.
 */
export function slowFiles(
  policy: Policy,
  projects: readonly NodeTestProject[],
): (testFile: TestFileRef) => boolean {
  const matches = createInputMatcher(policy.slow.include);
  const slowProjects: ReadonlySet<ProjectName> = new Set(
    marked(policy, projects).map((project) => project.name),
  );
  return (testFile) => slowProjects.has(testFile.project) || matches(testFile.path);
}

/**
 * Every glob that marks slow files, worktree-relative: `slow.include`, then
 * the `include` globs of each node:test project in `projects` and each
 * pytest entry marked slow, joined to its `cwd`.
 */
export function slowGlobs(policy: Policy, projects: readonly NodeTestProject[]): string[] {
  const globs = [...policy.slow.include];
  for (const project of marked(policy, projects)) {
    const cwd = project.cwd ?? ".";
    for (const glob of project.include) globs.push(posix.join(cwd, glob));
  }
  return globs;
}

/** The entries of `projects` and `policy.pytest` marked `slow: true`, in that order. */
function marked(policy: Policy, projects: readonly NodeTestProject[]): Marking[] {
  return [...projects, ...policy.pytest].filter((project) => project.slow === true);
}
