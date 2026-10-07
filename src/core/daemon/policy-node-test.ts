import { isAbsolute, posix } from "node:path";
import { isRecord } from "../fs/index.js";
import { globToRegExp } from "../keys/glob.js";
import type { NodeTestProject } from "../types/index.js";

/** `null` when every glob compiles, else the problem with the first that does not. */
export function compiles(globs: readonly string[]): { readonly problem: string } | null {
  for (const glob of globs) {
    try {
      globToRegExp(glob);
    } catch (error) {
      return { problem: `has a glob Squeal cannot use: ${(error as Error).message}` };
    }
  }
  return null;
}

/** Checks one key of an entry: `null`, what was expected, or a whole problem. */
type Field = (value: unknown) => string | { readonly problem: string } | null;

const nonEmptyString: Field = (v) =>
  typeof v === "string" && v.length > 0 ? null : "a non-empty string";
const strings: Field = (v) =>
  Array.isArray(v) && v.every((s) => typeof s === "string") ? null : "an array of strings";
const globs: Field = (v) =>
  Array.isArray(v) && v.length > 0 && v.every((s) => typeof s === "string")
    ? compiles(v as string[])
    : "a non-empty array of strings";
const variables: Field = (v) =>
  isRecord(v) && Object.values(v).every((s) => typeof s === "string")
    ? null
    : "an object from variable name to string";
/** Spec 003 D1: "`cwd` (relative to the worktree root, default the root)". */
const insideRoot: Field = (v) => {
  if (typeof v !== "string") return "a path inside the worktree, relative to its root";
  const normal = posix.normalize(v.replaceAll("\\", "/"));
  return isAbsolute(v) || normal === ".." || normal.startsWith("../")
    ? "a path inside the worktree, relative to its root"
    : null;
};

/** Every key of `NodeTestProject`; `name` and `include` are required. */
const FIELDS: Readonly<Record<keyof NodeTestProject, Field>> = {
  name: nonEmptyString,
  cwd: insideRoot,
  node: nonEmptyString,
  argv: strings,
  env: variables,
  include: globs,
  exclude: globs,
};
const REQUIRED: ReadonlySet<string> = new Set(["name", "include"]);

/**
 * The `nodeTest` rule of the policy loader (spec 003 D1). A list that is not
 * a list is no projects; an entry that is not valid is one problem and is
 * left out, the others are kept: "a bad entry is a problem note with that
 * project skipped, never a crash." `argv` defaults to `[]` and `env` to `{}`.
 */
export function nodeTestProjects(
  value: unknown,
  path: string,
): string | { readonly kept: readonly NodeTestProject[]; readonly problems: readonly string[] } {
  if (!Array.isArray(value)) return "an array of projects";
  const kept: NodeTestProject[] = [];
  const problems: string[] = [];
  value.forEach((entry: unknown, index) => {
    const at = `${path}[${index}]`;
    const problem = entryProblem(entry, at, kept);
    if (problem === null) kept.push(withDefaults(entry as Partial<NodeTestProject>));
    else problems.push(problem);
  });
  return { kept, problems };
}

function withDefaults(entry: Partial<NodeTestProject>): NodeTestProject {
  return { ...entry, argv: entry.argv ?? [], env: entry.env ?? {} } as NodeTestProject;
}

function entryProblem(entry: unknown, at: string, kept: readonly NodeTestProject[]): string | null {
  if (!isRecord(entry)) return `"${at}" must be an object, got ${JSON.stringify(entry)}; it is skipped`;
  const named = nonEmptyString(entry.name) === null ? (entry.name as string) : null;
  const skipped = named === null ? "it is skipped" : `project ${JSON.stringify(named)} is skipped`;
  for (const key of Object.keys(entry)) {
    if (!Object.hasOwn(FIELDS, key)) return `unknown key "${at}.${key}"; ${skipped}`;
  }
  for (const [key, field] of Object.entries(FIELDS)) {
    const given = entry[key];
    if (given === undefined && !REQUIRED.has(key)) continue;
    const expected = field(given);
    if (expected === null) continue;
    const why =
      typeof expected === "object"
        ? expected.problem
        : `must be ${expected}, got ${given === undefined ? "undefined" : JSON.stringify(given)}`;
    return `"${at}.${key}" ${why}; ${skipped}`;
  }
  if (kept.some((project) => project.name === named)) {
    return `"${at}.name" repeats ${JSON.stringify(named)} of an earlier project; it is skipped`;
  }
  return null;
}
