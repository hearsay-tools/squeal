import { posix } from "node:path";
import { compare } from "../fs/index.js";
import type { Closure, ClosureMethod, RelativePath, RunnerClosure } from "../types/index.js";
import { createInputMatcher } from "./glob.js";

export const CLOSURE_METHOD: ClosureMethod = "static imports plus declared inputs";

/** Segments without separators, none of them `.` or `..`, no drive letter. Most runner paths. */
const ALREADY_NORMAL = /^(?![A-Za-z]:)(?!\.\.?(?:\/|$))[^/\\]+(?:\/(?!\.\.?(?:\/|$))[^/\\]+)*$/;

/**
 * Normalizes a worktree-relative path to `/` separators with no `.`, `..` or
 * empty segments. Throws for absolute paths and paths leaving the worktree:
 * an absolute path in a key would make it differ between worktrees.
 */
export function normalizeRelativePath(path: string): RelativePath {
  if (ALREADY_NORMAL.test(path)) return path;
  const slashed = path.replaceAll("\\", "/");
  if (slashed === "" || slashed.startsWith("/") || /^[A-Za-z]:\//.test(slashed)) {
    throw new Error(`squeal: expected a worktree-relative path, got "${path}"`);
  }
  const normalized = posix.normalize(slashed).replace(/\/$/, "");
  if (normalized === "." || normalized === ".." || normalized.startsWith("../")) {
    throw new Error(`squeal: path leaves the worktree: "${path}"`);
  }
  return normalized;
}

/**
 * The files matching policy `inputs` globs, sorted. `files` is every file the
 * caller knows in the worktree: tracked, untracked and ignored-but-watched.
 *
 * Spec 001 D3: the closure includes "any policy-declared `inputs` globs that
 * match". Each match joins every closure: v1 cannot tell which test reads
 * which fixture.
 */
export function selectDeclaredInputs(
  globs: readonly string[],
  files: Iterable<RelativePath>,
): RelativePath[] {
  const matches = createInputMatcher(globs);
  const selected: RelativePath[] = [];
  for (const file of files) if (matches(file)) selected.push(file);
  return selected.sort(compare);
}

/**
 * The final closure of a test file.
 *
 * Spec 001 D3: "**Closure** of a test file: the test file, its transitive
 * static and dynamic project imports from Vitest's transform graph (D4), its
 * snapshot file(s), and any policy-declared `inputs` globs that match.
 * `node_modules` is excluded from the closure and covered by the environment
 * hash. Every closure carries `complete: false` in v1".
 */
export function assembleClosure(
  runner: RunnerClosure,
  declaredInputs: Iterable<RelativePath>,
): Closure {
  const paths = new Set<RelativePath>();
  const include = (path: string) => {
    let normalized: RelativePath;
    try {
      normalized = normalizeRelativePath(path);
    } catch (error) {
      const { project, path: testPath } = runner.testFile;
      throw new Error(`squeal: closure of ${project}:${testPath}: ${(error as Error).message}`);
    }
    if (!isNodeModules(normalized)) paths.add(normalized);
  };
  include(runner.testFile.path);
  for (const path of runner.paths) include(path);
  for (const path of declaredInputs) include(path);
  return {
    testFile: runner.testFile,
    paths: [...paths].sort(compare),
    complete: false,
    method: CLOSURE_METHOD,
  };
}

function isNodeModules(path: RelativePath): boolean {
  return path.startsWith("node_modules/") || path.includes("/node_modules/");
}
