/**
 * Check identity of node:test tests (spec 003 D2, goal 3).
 *
 * A full name joins the names of a test's suites and parent tests and its
 * own name with ` > `. Suites (`describe`, `suite`) are never checks, only
 * name prefixes, as in Vitest; a `test`, `it` or `t.test` is a check whether
 * or not it has subtests (coordinator, 2026-10-07). When two checks of one
 * file share a full name, the second and later carry their source line:
 * `name (line N)`, then `name (line N, k)` for more on one line, the format
 * of `src/runners/vitest/results.ts` (001 D4). Runtime `testId`,
 * `testNumber` and ordinals are never keys.
 */

export const NAME_SEPARATOR = " > ";

/** One reported test or suite of one test file, in report order. */
export interface ReportedTest {
  readonly name: string;
  readonly nesting: number;
  /** Node 24: unique within the file's process. Node 22 has neither id. */
  readonly testId?: number | undefined;
  readonly parentId?: number | undefined;
  readonly suite: boolean;
  /** Source-mapped declaration line; `null` when Node gave none. */
  readonly line: number | null;
}

export interface IdentifiedTest<T extends ReportedTest> {
  readonly test: T;
  /** The check name: the full name, suffixed when it repeats. */
  readonly fullName: string;
  /** Enclosing suites and tests, outermost first. */
  readonly ancestors: readonly T[];
}

/**
 * Names the checks among `tests`, in their order. On Node 24 the tree comes
 * from `parentId`; on Node 22 from `nesting` and report order, where every
 * test is reported after its subtests (research, runner-api 1: "Declaration-
 * ordered pass/fail events are safer for reconstructing nesting on 22").
 */
export function identify<T extends ReportedTest>(tests: readonly T[]): IdentifiedTest<T>[] {
  const parents = tests.every(hasIds) ? parentsById(tests) : parentsByNesting(tests);
  const ancestorsOf = (test: T): T[] => {
    const chain: T[] = [];
    for (let p = parents.get(test); p !== undefined; p = parents.get(p)) chain.unshift(p);
    return chain;
  };
  const checks = tests
    .filter((test) => !test.suite)
    .map((test) => {
      const ancestors = ancestorsOf(test);
      const fullName = [...ancestors, test].map((t) => t.name).join(NAME_SEPARATOR);
      return { test, ancestors, fullName };
    });
  const names = suffixDuplicates(checks.map((c) => ({ fullName: c.fullName, line: c.test.line })));
  return checks.map((check, i) => ({ ...check, fullName: names[i] ?? check.fullName }));
}

/**
 * Check names for full names in declaration order: the first keeps its
 * name, the second and later carry their line (spec 001 D4).
 */
export function suffixDuplicates(
  checks: readonly { readonly fullName: string; readonly line: number | null }[],
): string[] {
  const used = new Set<string>();
  return checks.map(({ fullName, line }) => {
    let name = fullName;
    if (used.has(name)) {
      const at = line === null ? "line ?" : `line ${line}`;
      name = `${fullName} (${at})`;
      for (let n = 2; used.has(name); n++) name = `${fullName} (${at}, ${n})`;
    }
    used.add(name);
    return name;
  });
}

function hasIds(test: ReportedTest): boolean {
  return typeof test.testId === "number" && typeof test.parentId === "number";
}

function parentsById<T extends ReportedTest>(tests: readonly T[]): Map<T, T> {
  const byId = new Map(tests.map((t) => [t.testId, t]));
  const parents = new Map<T, T>();
  for (const test of tests) {
    const parent = byId.get(test.parentId);
    if (parent !== undefined && parent !== test) parents.set(test, parent);
  }
  return parents;
}

/** Each test adopts the tests one level deeper reported since the last test at its level. */
function parentsByNesting<T extends ReportedTest>(tests: readonly T[]): Map<T, T> {
  const parents = new Map<T, T>();
  const pending = new Map<number, T[]>();
  for (const test of tests) {
    for (const child of pending.get(test.nesting + 1) ?? []) parents.set(child, test);
    pending.set(test.nesting + 1, []);
    pending.set(test.nesting, [...(pending.get(test.nesting) ?? []), test]);
  }
  return parents;
}
