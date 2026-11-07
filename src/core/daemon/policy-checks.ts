import { isRecord } from "../fs/json.js";
import type { CheckGroup } from "../types/check-groups.js";
import { CHECK_MOMENTS, CHECK_RUNNERS, DEFAULT_GROUP_NAMES } from "./check-groups.js";
import type { Kept } from "./config-file.js";
import { compiles } from "./policy-node-test.js";

/*
 * Spec 019 D1: the `checks` leaf of the policy loader. Each entry is checked
 * on its own here; a bad entry is one problem and is left out, the others
 * are kept (001 D11). What needs the other keys or the other groups (a
 * `project` the runner has, `lint` tools, names, `after`) is
 * `settleChecks`'s, once the whole file is merged.
 */

/** What one key's value is wrong by: the whole problem after its quoted path, or `null`. */
type Rule = (value: unknown, path: string) => string | null;

const show = (value: unknown): string =>
  value === undefined ? "undefined" : JSON.stringify(value);
const must =
  (expected: string, ok: (value: unknown) => boolean): Rule =>
  (value, path) =>
    ok(value) ? null : `"${path}" must be ${expected}, got ${show(value)}`;
const oneOf = (values: readonly string[]): Rule =>
  must(`one of ${values.map((v) => `"${v}"`).join(", ")}`, (v) => values.includes(v as string));
const isNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const positiveInteger = must("a positive integer", (v) => Number.isInteger(v) && (v as number) > 0);
const atLeastZero = must("a number >= 0", (v) => isNumber(v) && v >= 0);
const aboveZero = must("a number > 0", (v) => isNumber(v) && v > 0);

/**
 * A group's name is a word, so `squeal run <group>` (D6) never reads as a
 * path or a flag.
 */
const NAME = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const name = must(
  "a name of letters, digits, - and _",
  (v) => typeof v === "string" && NAME.test(v),
);
const names = must(
  "an array of group names",
  (v) => Array.isArray(v) && v.every((s) => typeof s === "string"),
);
const tests: Rule = (value, path) => {
  const wrong = must(
    "a non-empty array of strings",
    (v) => Array.isArray(v) && v.length > 0 && v.every((s) => typeof s === "string"),
  )(value, path);
  if (wrong !== null) return wrong;
  const bad = compiles(value as string[]);
  return bad === null ? null : `"${path}" ${bad.problem}`;
};
const lint = must(
  `true, or a non-empty array of "eslint" and "oxlint"`,
  (v) =>
    v === true ||
    (Array.isArray(v) && v.length > 0 && v.every((s) => s === "eslint" || s === "oxlint")),
);

/** An object of `rules`; an unknown key or a bad value is the first problem found. */
const object =
  (rules: Readonly<Record<string, Rule>>): Rule =>
  (value, path) => {
    if (!isRecord(value)) return `"${path}" must be an object, got ${show(value)}`;
    for (const key of Object.keys(value)) {
      if (!Object.hasOwn(rules, key)) return `unknown key "${path}.${key}"`;
    }
    for (const [key, rule] of Object.entries(rules)) {
      if (value[key] === undefined) continue;
      const problem = rule(value[key], `${path}.${key}`);
      if (problem !== null) return problem;
    }
    return null;
  };

/** D3: every key optional; `deferUnderLoad`'s absent keys take today's slow defaults. */
const limits = object({
  maxParallel: positiveInteger,
  maxWorkers: positiveInteger,
  priority: oneOf(["normal", "low"]),
  deferUnderLoad: object({ maxLoadPerCpu: aboveZero, maxDeferMs: atLeastZero }),
});

const moment = oneOf(CHECK_MOMENTS);
const COMMON: Readonly<Record<string, Rule>> = {
  name,
  at: moment,
  after: names,
  quietMs: atLeastZero,
  limits,
};
const TEST_RULES = object({
  ...COMMON,
  runner: oneOf(CHECK_RUNNERS),
  project: must("a non-empty string", (v) => typeof v === "string" && v.length > 0),
  tests,
});
const LINT_RULES = object({ name, at: moment, lint });
/** Keys only a test group has, named when a lint group carries one. */
const TEST_ONLY = ["project", "tests"] as const;
/**
 * Row 019-45: keys a test group honours and the lint pass does not build;
 * on a lint group each is a problem, never accepted and ignored (D1 as
 * amended 2026-11-05).
 */
const TEST_GROUP_ONLY = ["after", "quietMs", "limits"] as const;

/**
 * The `checks` rule (D1): a list that is not a list is what was expected,
 * so the default `[]` applies; otherwise the entries kept and one problem
 * per entry left out.
 */
export function checkGroups(value: unknown): string | Kept {
  if (!Array.isArray(value)) return "an array of check groups";
  const kept: CheckGroup[] = [];
  const problems: string[] = [];
  value.forEach((entry: unknown, index) => {
    const at = `checks[${index}]`;
    const problem = entryProblem(entry, at) ?? nameProblem(entry as CheckGroup, at, kept);
    if (problem === null) kept.push(entry as CheckGroup);
    else problems.push(problem);
  });
  return { kept, problems };
}

/** A name another kept group or a default group (D2) has: `after` and `squeal run` need one meaning. */
function nameProblem(entry: CheckGroup, at: string, kept: readonly CheckGroup[]): string | null {
  if (DEFAULT_GROUP_NAMES.includes(entry.name)) {
    return `"${at}.name" is "${entry.name}", the name of a default group; it is left out`;
  }
  if (kept.some((group) => group.name === entry.name)) {
    return `"${at}.name" repeats "${entry.name}" of an earlier group; it is left out`;
  }
  return null;
}

function entryProblem(entry: unknown, at: string): string | null {
  if (!isRecord(entry)) return `"${at}" must be an object, got ${show(entry)}; it is left out`;
  const problem = shapeProblem(entry, at);
  return problem === null ? null : `${problem}; ${leftOut(entry)}`;
}

function shapeProblem(entry: Readonly<Record<string, unknown>>, at: string): string | null {
  const isTest = entry.runner !== undefined;
  const isLint = entry.lint !== undefined;
  if (isTest && isLint) return `"${at}" has both "runner" and "lint"; a group has one`;
  if (!isTest && !isLint) return `"${at}" has neither "runner" nor "lint"; a group needs one`;
  if (isLint) {
    const testKey = TEST_ONLY.find((key) => entry[key] !== undefined);
    if (testKey !== undefined) return `"${at}.${testKey}" needs "runner"; a lint group has none`;
    const unbuilt = TEST_GROUP_ONLY.find((key) => entry[key] !== undefined);
    if (unbuilt !== undefined) {
      return `"${at}.${unbuilt}" applies to test groups only; a lint group has "name", "lint" and "at"`;
    }
  }
  for (const key of ["name", "at"]) {
    if (entry[key] === undefined) return `"${at}.${key}" is missing; every group needs one`;
  }
  return (isTest ? TEST_RULES : LINT_RULES)(entry, at);
}

/** The end of a problem: the group by its name when it has a valid one. */
export function leftOut(entry: Readonly<Record<string, unknown>>): string {
  return typeof entry.name === "string" && NAME.test(entry.name)
    ? `group "${entry.name}" is left out`
    : "it is left out";
}
