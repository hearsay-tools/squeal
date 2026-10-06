import { posix } from "node:path";
import { compare } from "../fs/index.js";
import type {
  Closure,
  ClosureMethod,
  PolicyInputs,
  RelativePath,
  RunnerClosure,
} from "../types/index.js";
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
 * Policy `inputs` resolved against the files of a worktree, answered per test
 * file. Spec 001 D3: the closure includes "any policy-declared `inputs` globs
 * that match"; D11 as amended: a list applies to every test file, a map
 * applies an entry's input globs only to the test files its glob matches.
 */
export interface DeclaredInputs {
  /** The declared inputs of the test file at `testFile`, sorted. */
  for(testFile: RelativePath): readonly RelativePath[];
  /** Every file any entry selects, sorted. */
  readonly all: readonly RelativePath[];
}

/**
 * Matches every input glob against `files` once; `for` then only matches the
 * test-file globs. `files` is every file the caller knows in the worktree:
 * tracked, untracked and ignored-but-watched.
 */
export function createDeclaredInputs(
  inputs: PolicyInputs,
  files: Iterable<RelativePath>,
): DeclaredInputs {
  const known = [...files];
  const select = (globs: readonly string[]) => {
    const matches = createInputMatcher(globs);
    return known.filter((file) => matches(file)).sort(compare);
  };
  if (isInputList(inputs)) {
    const selected = select(inputs);
    return { for: () => selected, all: selected };
  }
  const rules = Object.entries(inputs).map(([testGlob, globs]) => ({
    applies: createInputMatcher([testGlob]),
    selected: select(globs),
  }));
  const union = (lists: readonly (readonly RelativePath[])[]) =>
    lists.length === 1
      ? (lists[0] as readonly RelativePath[])
      : [...new Set(lists.flat())].sort(compare);
  return {
    for: (testFile) => union(rules.filter((r) => r.applies(testFile)).map((r) => r.selected)),
    all: union(rules.map((r) => r.selected)),
  };
}

/**
 * The files matching policy `inputs` for `testFile`, sorted; for every test
 * file when `testFile` is not given. A list applies to every test file.
 */
export function selectDeclaredInputs(
  inputs: PolicyInputs,
  files: Iterable<RelativePath>,
  testFile?: RelativePath,
): RelativePath[] {
  const declared = createDeclaredInputs(inputs, files);
  return [...(testFile === undefined ? declared.all : declared.for(testFile))];
}

/** Entries of policy `inputs` that select nothing. */
export interface UnmatchedInputs {
  /** Map keys whose test-file glob matches no test file, sorted. */
  readonly testGlobs: readonly string[];
  /** Input globs, of either shape, that match no file, sorted. */
  readonly inputGlobs: readonly string[];
}

/**
 * The entries of `inputs` that select nothing among `testFiles` and `files`.
 * Globs match worktree-relative paths from the start of the path to its end
 * (`globToRegExp`), so `"plugin.test.ts"` matches only a file at the root.
 * Review wave 4.5, S5: such an entry was accepted silently.
 */
export function unmatchedInputs(
  inputs: PolicyInputs,
  testFiles: Iterable<RelativePath>,
  files: Iterable<RelativePath>,
): UnmatchedInputs {
  const known = [...files];
  const matchesNone = (glob: string, paths: readonly RelativePath[]) => {
    const matches = createInputMatcher([glob]);
    return !paths.some((path) => matches(path));
  };
  const tests = [...testFiles];
  const testGlobs = isInputList(inputs)
    ? []
    : Object.keys(inputs).filter((glob) => matchesNone(glob, tests));
  return {
    testGlobs: testGlobs.sort(compare),
    inputGlobs: inputGlobs(inputs)
      .filter((glob) => matchesNone(glob, known))
      .sort(compare),
  };
}

/** Every input glob of either shape, without duplicates: what makes a path a declared input. */
export function inputGlobs(inputs: PolicyInputs): string[] {
  return isInputList(inputs) ? [...inputs] : [...new Set(Object.values(inputs).flat())];
}

/** Whether two `inputs` select the same files: lists in order, maps by entry in any key order. */
export function sameInputs(a: PolicyInputs, b: PolicyInputs): boolean {
  if (isInputList(a) || isInputList(b)) {
    return isInputList(a) && isInputList(b) && sameList(a, b);
  }
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => Object.hasOwn(b, key) && sameList(a[key] ?? [], b[key] ?? []))
  );
}

export function isInputList(inputs: PolicyInputs): inputs is readonly string[] {
  return Array.isArray(inputs);
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, i) => value === b[i]);
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
