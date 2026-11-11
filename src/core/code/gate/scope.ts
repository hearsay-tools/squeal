import { groupOf, resolveGroups } from "../../daemon/check-groups.js";
import { compare } from "../../fs/compare.js";
import type { CheckMoment, CheckRunner, ResolvedGroup } from "../../types/check-groups.js";
import type { RelativePath } from "../../types/common.js";
import type { TestFileRef } from "../../types/keys.js";
import type { Policy } from "../../types/policy.js";
import type { TestFileEvidence } from "./types.js";

/*
 * Spec 020 D14 (row 020-15a): the gate's scope by check group (spec 019
 * D1). The groups come from `checks` at the merge base, so a branch cannot
 * move a group out of its own gate. By default every test group whose
 * moment is not `manual` is in scope; `gate.groups`, read at the base too,
 * replaces that default; `--group` adds groups for one run. `--test` files
 * run whatever their group (the collector's). Pure: nothing here lists or
 * reads a file.
 */

/** D14.1: where a group in scope came from. */
export type ScopeSource = "default" | "gate.groups" | "--group";

/** D14.1: the groups at the merge base and `gate.groups` as kept there. */
export interface ScopeBase {
  /** Every group at the base, in ownership order (019 D1), lint groups included. */
  readonly groups: readonly ResolvedGroup[];
  /** `gate.groups` without its unknown names and lint groups; `null` when not set. */
  readonly configured: readonly string[] | null;
}

/** One group in scope. */
export interface ScopeGroup {
  readonly name: string;
  readonly at: CheckMoment;
  readonly from: ScopeSource;
}

/** D14.1: the resolved scope of one run. */
export interface GateScope {
  /** Every group at the base, in ownership order: a test file belongs to the first that selects it. */
  readonly groups: readonly ResolvedGroup[];
  /** The test groups in scope, in ownership order. */
  readonly inScope: readonly ScopeGroup[];
}

/** One selected test file the scope left out: it did not run, and its closure was read (D14.2). */
export interface LeftOutFile {
  readonly runner: TestFileEvidence["runner"];
  readonly path: RelativePath;
  readonly group: string;
  /** The sources its closure loads; `null` when the closure is not known. */
  readonly loads: readonly RelativePath[] | null;
}

/** D14.3: one test group out of scope that owns a listed test file. */
export interface LeftOutGroup {
  readonly name: string;
  readonly at: CheckMoment;
  /** Its test files, over every runner. */
  readonly files: number;
  /** Of those, the ones the selection picked: they load changed code, or changed. */
  readonly selected: number;
  /** What adds it for one run. */
  readonly add: string;
}

/** D14: what the collector gives the evaluator of the scope. */
export interface ScopeEvidence {
  readonly inScope: readonly ScopeGroup[];
  /** By the groups' ownership order; empty when no runner listed its files (nothing changed). */
  readonly leftOut: readonly LeftOutGroup[];
  /** By runner, then path. */
  readonly files: readonly LeftOutFile[];
}

const isTestGroup = (group: ResolvedGroup) => group.select.kind !== "lint";

const LINT_ONLY = "is a lint group, and the gate runs test groups only";

/**
 * D14.1: the groups of `policy`, as `loadPolicy` read it at the merge base,
 * and its `gate.groups` without the names that are not a test group there,
 * each one a problem line.
 */
export function readScope(policy: Policy): {
  readonly base: ScopeBase;
  readonly problems: readonly string[];
} {
  const groups = resolveGroups(policy);
  const names = policy.gate.groups;
  if (names === null) return { base: { groups, configured: null }, problems: [] };
  const problems: string[] = [];
  const configured: string[] = [];
  for (const name of new Set(names)) {
    const group = groups.find((g) => g.name === name);
    if (group === undefined) {
      problems.push(
        `gate.groups: "${name}" names no test group of "checks", "tests" or "slow"; it is dropped`,
      );
    } else if (!isTestGroup(group)) {
      problems.push(`gate.groups: "${name}" ${LINT_ONLY}; it is dropped`);
    } else configured.push(name);
  }
  return { base: { groups, configured }, problems };
}

/**
 * D14.1: the scope at `base` with the `--group` names `added`; or the usage
 * error of a name that is not a test group there (D1, exit 2).
 */
export function resolveScope(
  base: ScopeBase,
  added: readonly string[],
): GateScope | { readonly error: string } {
  const tests = base.groups.filter(isTestGroup);
  for (const name of added) {
    const group = base.groups.find((g) => g.name === name);
    if (group === undefined) {
      const known = tests.map((g) => g.name).join(", ");
      return {
        error: `--group ${name}: no test group of that name at the merge base; its test groups are ${known}`,
      };
    }
    if (!isTestGroup(group)) return { error: `--group ${name}: "${name}" ${LINT_ONLY}` };
  }
  const sourceOf = (group: ResolvedGroup): ScopeSource | null => {
    if (base.configured === null) {
      if (group.at !== "manual") return "default";
    } else if (base.configured.includes(group.name)) return "gate.groups";
    return added.includes(group.name) ? "--group" : null;
  };
  const inScope = tests.flatMap((group) => {
    const from = sourceOf(group);
    return from === null ? [] : [{ name: group.name, at: group.at, from }];
  });
  return { groups: base.groups, inScope };
}

/** A test file's runner by its `squeal.config.json` key (019 D1). */
const CHECK_RUNNER: Readonly<Record<TestFileEvidence["runner"], CheckRunner>> = {
  vitest: "vitest",
  "node-test": "nodeTest",
};

/**
 * D14.1: the group that owns a test file of `runner`, its moment, and
 * whether the scope runs it. The default groups select every test file, so
 * a file always has one; `tests` stands in should none.
 */
export function placeFile(
  scope: GateScope,
  runner: TestFileEvidence["runner"],
  ref: TestFileRef,
): { readonly group: string; readonly at: CheckMoment; readonly inScope: boolean } {
  const check = { kind: "test", runner: CHECK_RUNNER[runner], ...ref } as const;
  const owner = groupOf(scope.groups, check);
  const name = owner?.name ?? "tests";
  const at = owner?.at ?? "edit";
  return { group: name, at, inScope: scope.inScope.some((g) => g.name === name) };
}

/** D14.3: the flag that puts a left-out group in scope for one run. */
export const addGroup = (name: string) => `--group ${name}`;

/**
 * D14.2: the left-out files that load `path`, or may (their closure is not
 * known), a changed test file among them; sorted.
 */
export function leftOutLoaders(
  files: readonly LeftOutFile[],
  path: RelativePath,
): readonly RelativePath[] {
  const loading = files.filter(
    (f) => f.path === path || f.loads === null || f.loads.includes(path),
  );
  return [...new Set(loading.map((f) => f.path))].sort(compare);
}
