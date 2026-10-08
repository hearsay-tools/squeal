import { createInputMatcher } from "../keys/glob.js";
import type { NodeTestProject, Policy, ProjectName, TestFileRef } from "../types/index.js";

/**
 * Spec 004 D1: which test files are slow. A file is slow when its
 * worktree-relative path matches a `slow.include` glob, whatever its runner,
 * or when its project is one of `projects` marked `slow: true`. `projects`
 * are the node:test projects the daemon runs, normally `policy.nodeTest`;
 * project names are unique across runners (spec 003 D7), so the name is
 * enough. The loader has left out every glob that does not compile.
 */
export function slowFiles(
  policy: Policy,
  projects: readonly NodeTestProject[],
): (testFile: TestFileRef) => boolean {
  const matches = createInputMatcher(policy.slow.include);
  const slowProjects: ReadonlySet<ProjectName> = new Set(
    projects.filter((project) => project.slow === true).map((project) => project.name),
  );
  return (testFile) => slowProjects.has(testFile.project) || matches(testFile.path);
}
