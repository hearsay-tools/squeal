import { lintGroupOf } from "../core/lint/pass/moment.js";
import type { CheckMoment, CheckRunner, ResolvedGroup } from "../core/types/check-groups.js";
import type { Policy } from "../core/types/policy.js";
import { TESTS_GROUP } from "../core/types/scheduler.js";

/*
 * Row 005-126: `squeal checks`' text. One block per check, in config order,
 * then the default checks: a name line, then one fact per line. Spec 019's
 * "group" is a check here; `squeal run <group>` is unchanged.
 */

/** What the store says of one test check: its listed files and their last results. */
export interface CheckResults {
  /** The test files the check owns in the daemon's last listing. */
  readonly files: number;
  readonly pass: number;
  readonly fail: number;
  /** Pending, stale, not run or unknown at the revision. */
  readonly notCurrent: number;
}

/** What the store gives `checksText`; `null` when there is no store or it cannot be read. */
export interface StoreView {
  /** The worktree's latest revision; `null` before the first. */
  readonly revision: number | null;
  /** Each test check's results by its name; absent for a lint check. */
  readonly results: ReadonlyMap<string, CheckResults>;
}

/**
 * When a check runs, and who starts it, for each moment but `manual`
 * (`runs`): spec 019 D6's words for the moment.
 */
const WHEN: Readonly<Record<Exclude<CheckMoment, "manual">, string>> = {
  edit: "after each edit",
  pause: "between your turns: Squeal starts it when your turn ends, not after an edit",
  stop: "at Stop: Squeal starts it when you stop, and Stop waits for it, not after an edit",
  commit: "when you commit: Squeal starts it when it sees a new commit, not after an edit",
};

const RUNNER: Readonly<Record<CheckRunner, string>> = {
  vitest: "Vitest",
  nodeTest: "node:test",
  pytest: "pytest",
};

/**
 * Every block of `squeal checks` for `groups` (`resolveGroups`' order) under
 * `policy`, with `store`'s counts when there is one; `command` names the CLI.
 */
export function checksText(
  policy: Policy,
  groups: readonly ResolvedGroup[],
  store: StoreView | null,
  command: string,
  notCovered: string,
): string {
  const blocks = groups.flatMap((group) => {
    const shown = group.index !== null || defaultShown(group, policy, store);
    return shown ? [groupBlock(group, policy, store, command)] : [];
  });
  const lint = defaultLintBlock(policy, command);
  if (lint !== null) blocks.push(lint);
  const intro =
    policy.checks.length === 0
      ? "squeal.config.json has no checks key; these are the default checks."
      : "The checks Squeal runs in this repository (squeal.config.json):";
  return `${intro}\n\n${blocks.join("\n")}\n${notCovered}\n`;
}

/**
 * A default check is shown while it can hold a file: `tests` unless the
 * store's listing has none left that no other check selects, `slow` only
 * where the config marks files slow.
 */
function defaultShown(group: ResolvedGroup, policy: Policy, store: StoreView | null): boolean {
  if (group.select.kind !== "marked") return false;
  if (group.name !== TESTS_GROUP) return marks(group.select);
  const files = store?.results.get(group.name)?.files;
  return policy.checks.length === 0 || files === undefined || files > 0;
}

function marks(select: Extract<ResolvedGroup["select"], { kind: "marked" }>): boolean {
  return select.include.length > 0 || select.projects.length > 0;
}

function groupBlock(
  group: ResolvedGroup,
  policy: Policy,
  store: StoreView | null,
  command: string,
): string {
  const results = store?.results.get(group.name);
  const off = never(group, policy);
  const lines = [
    group.name,
    ...(group.description === undefined ? [] : [`  Description: ${group.description}`]),
    `  Selects: ${selects(group, policy)}`,
    ...(results === undefined ? [] : [`  Test files now: ${results.files}`]),
    `  Runs: ${off === null ? runs(group, command) : `never: ${off}`}`,
    ...(group.after.length === 0 ? [] : [`  Starts after: ${group.after.join(", ")}`]),
    ...(off === null ? [`  Run it now: \`${command} run ${group.name} --wait 60000\``] : []),
    ...(results === undefined || results.files === 0
      ? []
      : [`  Last result${revisionText(store)}: ${resultText(results)}`]),
  ];
  return `${lines.join("\n")}\n`;
}

/**
 * Review of cand/0.1.565, B1: the tools of lint check `group` the lint pass
 * runs, by the pass's own ownership rule (`lintGroupOf`, the first check
 * that selects a tool of `lint.tools`).
 */
function ownedTools(group: ResolvedGroup, policy: Policy): readonly string[] {
  return policy.lint.tools.filter((tool) => lintGroupOf(policy, tool)?.name === group.name);
}

/**
 * Why the lint pass never runs lint check `group`, or `null` when it does:
 * lint is off (the pass lints nothing, `lint/pass/index.ts`), `lint.tools` is
 * empty (review 0.1.565-r2 N1, row 005-130), or a check above it owns each of
 * its tools. A test check always runs.
 */
function never(group: ResolvedGroup, policy: Policy): string | null {
  if (group.select.kind !== "lint") return null;
  if (!policy.lint.enabled) return "lint is off (lint.enabled in squeal.config.json)";
  if (policy.lint.tools.length === 0) return "lint.tools is empty (squeal.config.json)";
  return ownedTools(group, policy).length === 0 ? "a check above it owns each of its tools" : null;
}

function selects(group: ResolvedGroup, policy: Policy): string {
  const { select } = group;
  switch (select.kind) {
    case "tests": {
      const project = select.project === null ? "" : ` of project "${select.project}"`;
      const tests = select.tests === null ? "" : ` matching ${select.tests.join(", ")}`;
      return `${RUNNER[select.runner]} test files${project}${tests}`;
    }
    case "lint": {
      const owned = ownedTools(group, policy);
      if (owned.length > 0) return `lint with ${owned.join(" and ")}`;
      return select.tools === null
        ? "lint, every tool in lint.tools"
        : `lint with ${select.tools.join(" and ")}`;
    }
    case "marked": {
      const named = [
        ...(select.include.length === 0 ? [] : [`slow.include ${select.include.join(", ")}`]),
        ...select.projects.map(({ runner, name }) => `${RUNNER[runner]} entry "${name}"`),
      ].join("; ");
      if (select.slow) return `test files marked slow: ${named}`;
      return `the test files no other check selects${marks(select) ? ", except those marked slow" : ""}`;
    }
  }
}

/** When the check runs and who starts it; Stop's wait when it waits for a check of another moment. */
function runs(group: ResolvedGroup, command: string): string {
  if (group.at === "manual") {
    return `only on request: Squeal does not start it; \`${command} run ${group.name} --wait 60000\` does`;
  }
  const when = WHEN[group.at];
  return group.stopRequires && group.at !== "stop" ? `${when}; Stop waits for it` : when;
}

function revisionText(store: StoreView | null): string {
  return store?.revision === null || store === null ? "" : ` at revision ${store.revision}`;
}

function resultText({ pass, fail, notCurrent }: CheckResults): string {
  const parts = [
    ...(pass === 0 ? [] : [`${pass} pass`]),
    ...(fail === 0 ? [] : [`${fail} ${fail === 1 ? "fails" : "fail"}`]),
    ...(notCurrent === 0 ? [] : [`${notCurrent} not current`]),
  ];
  return parts.join(", ");
}

/**
 * Lint as the config enables it for the tools no lint check owns (019 D2):
 * the edited file at each edit (spec 017 D5), with no run command of its
 * own. Ownership is the lint pass's own (`lintGroupOf`); with every tool
 * owned, no block (review of cand/0.1.565).
 */
function defaultLintBlock(policy: Policy, command: string): string | null {
  if (!policy.lint.enabled) return null;
  const tools = policy.lint.tools.filter((tool) => lintGroupOf(policy, tool) === null);
  if (tools.length === 0) return null;
  return [
    "lint",
    `  Selects: lint with ${tools.join(" and ")}`,
    "  Runs: after each edit, on the edited file",
    `  Findings: \`${command} lint\``,
    "",
  ].join("\n");
}
