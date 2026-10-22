import { statSync } from "node:fs";
import { join, posix } from "node:path";
import { POLICY_FILE } from "../../core/daemon/policy.js";
import { globToRegExp } from "../../core/keys/glob.js";
import type { NodeTestProject, Policy } from "../../core/types/index.js";
import type { RepoFacts } from "./repo.js";

/*
 * Row 005-40 (`research/e2e-setup.md` defect 4): a `slow.include` entry and
 * an `inputs` key are test globs, and one that selects no test file applies
 * to nothing, silently. The common slip is a bare directory: `test/e2e`
 * matches no file, so it is taken as `test/e2e/**` and said so.
 */

/**
 * The test files Squeal validates here: the listed ones and every node:test
 * project's, each its `include` minus its `exclude` as the adapter lists them
 * (review 005-42 B1).
 */
export function testFileUniverse(facts: RepoFacts, projects: readonly Project[]): string[] {
  const inProjects = projects.map(selects);
  const inProject = (path: string) => inProjects.some((test) => test(path));
  return [...new Set([...facts.testFiles.paths, ...facts.tracked.filter(inProject)])];
}

/** The tracked files one node:test or pytest project lists (rows 005-80: its warm-up runs, its overlaps). */
export function projectFiles(facts: RepoFacts, project: Project): string[] {
  return facts.tracked.filter(selects(project));
}

type Project = Pick<NodeTestProject, "cwd" | "include" | "exclude">;

/** A project's `include` minus its `exclude`, both relative to its `cwd`. */
function selects(project: Project): (path: string) => boolean {
  const under = (globs: readonly string[]) =>
    matcher(globs.map((g) => posix.join(project.cwd ?? "", g)));
  const include = under(project.include);
  const exclude = under(project.exclude ?? []);
  return (path) => include(path) && !exclude(path);
}

/** `--check`'s line for each `slow.include` entry and `inputs` key that selects none of `files`. */
export function unselected(policy: Policy, files: readonly string[]): string[] {
  const keys = Array.isArray(policy.inputs) ? [] : Object.keys(policy.inputs);
  const named = [
    ...policy.slow.include.map((glob) => ({ glob, where: "slow.include entry" })),
    ...keys.map((glob) => ({ glob, where: "inputs key" })),
  ];
  return named
    .filter(({ glob }) => !selectsAny(glob, files))
    .map(({ glob, where }) => {
      const dir = asDirectoryGlob(glob, holdsTestFile(files));
      const hint = dir === glob ? "" : `; a directory takes /**: "${dir}"`;
      return `${POLICY_FILE}: the ${where} "${glob}" selects no test file${hint}`;
    });
}

/** Whether `glob` selects any of `files`; a glob Squeal cannot compile selects none. */
export function selectsAny(glob: string, files: readonly string[]): boolean {
  return files.some(matcher([glob]));
}

/**
 * `glob` as `<dir>/**` when it has no wildcard and `isDirectory` says it
 * names a directory, a trailing `/` dropped; otherwise `glob` itself.
 */
export function asDirectoryGlob(glob: string, isDirectory: (path: string) => boolean): string {
  if (/[*?[{]/.test(glob)) return glob;
  const dir = glob.replace(/\/+$/, "");
  return dir !== "" && isDirectory(dir) ? `${dir}/**` : glob;
}

/** A directory holding some of `files`: how a test glob names one. */
export function holdsTestFile(files: readonly string[]): (dir: string) => boolean {
  return (dir) => files.some((file) => file.startsWith(`${dir}/`));
}

/** A directory in the worktree at `root`: how an input glob names one, built or not. */
export function directoryIn(root: string): (dir: string) => boolean {
  return (dir) => {
    try {
      return statSync(join(root, dir)).isDirectory();
    } catch {
      return false;
    }
  };
}

function matcher(globs: readonly string[]): (path: string) => boolean {
  const patterns = globs.flatMap((glob) => {
    try {
      return [globToRegExp(glob)];
    } catch {
      return [];
    }
  });
  return (path) => patterns.some((pattern) => pattern.test(path));
}
