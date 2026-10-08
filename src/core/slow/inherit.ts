import { posix } from "node:path";
import type { NodeTestProject, Policy, RelativePath } from "../types/index.js";

/** A test file as inheritance reads it: its worktree-relative path and whether it is slow (D1). */
export interface InheritanceSubject {
  readonly path: RelativePath;
  readonly slow: boolean;
}

/**
 * Spec 004 D6: whether another worktree's result may stand for `testFile`.
 * True when the file is not slow, or when its declared inputs hold the
 * artifact it tests: one of `declaredInputs`, the existing files policy
 * `inputs` selects for it (`DeclaredInputs.for`), is neither one of
 * `testFiles` nor under a directory a glob of `slowGlobs` covers. A worktree
 * reuses its own results under their keys whatever this says.
 */
export function inheritsAcrossWorktrees(
  testFile: InheritanceSubject,
  declaredInputs: readonly RelativePath[],
  testFiles: ReadonlySet<RelativePath>,
  slowGlobs: readonly string[],
): boolean {
  if (!testFile.slow) return true;
  const covered = slowGlobs.map(coveredPrefix);
  return declaredInputs.some(
    (path) => !testFiles.has(path) && !covered.some((prefix) => covers(prefix, path)),
  );
}

/**
 * Every glob that marks slow files, worktree-relative: `slow.include`, then
 * the `include` globs of each node:test project in `projects` marked slow,
 * joined to its `cwd`.
 */
export function slowGlobs(policy: Policy, projects: readonly NodeTestProject[]): string[] {
  const globs = [...policy.slow.include];
  for (const project of projects) {
    if (project.slow !== true) continue;
    const cwd = project.cwd ?? ".";
    for (const glob of project.include) globs.push(posix.join(cwd, glob));
  }
  return globs;
}

/** A covered literal path, or the directory a glob's literal prefix names (with `/`); `""` covers every path. */
type Covered = { readonly file: RelativePath } | { readonly dir: string };

const GLOB_CHARS = /[*?[{]/;

/** The directories before a glob's first wildcard segment; a glob without one covers its own path only. */
function coveredPrefix(glob: string): Covered {
  const source = glob.startsWith("./") ? glob.slice(2) : glob;
  const segments = source.split("/");
  const wild = segments.findIndex((segment) => GLOB_CHARS.test(segment));
  if (wild === -1) return { file: source };
  return {
    dir: segments
      .slice(0, wild)
      .map((segment) => `${segment}/`)
      .join(""),
  };
}

function covers(covered: Covered, path: RelativePath): boolean {
  return "file" in covered ? covered.file === path : path.startsWith(covered.dir);
}
