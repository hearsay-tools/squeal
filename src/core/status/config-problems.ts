import { describeProblems, unknownKey } from "../daemon/config-file.js";
import { loadPolicy, POLICY_FILE } from "../daemon/policy.js";
import { findWorktreeRoot } from "../fs/index.js";
import type { AbsolutePath, IgnoredConfigRule, StatusResult } from "../types/index.js";
import { ignoredConfigOf } from "./ignored-config.js";

/**
 * Row 011-07, issue 21: the problems the policy loader reports for the
 * worktree's `squeal.config.json`, the ones `setup --check` names, read by
 * status itself so they show with no store and before any daemon noted them
 * (011 C6, C10). Absent for a valid or missing config, so its output is today's.
 */
export function configProblemsOf(root: AbsolutePath): { configProblems?: readonly string[] } {
  const { problems } = loadPolicy(root);
  return problems.length === 0 ? {} : { configProblems: problems };
}

/**
 * A status unavailable for a worktree adds its config problems, and the keys
 * this runtime does not apply (row 011-275; no daemon is read); outside a
 * worktree nothing.
 */
export function withConfigProblems(result: StatusResult, cwd: AbsolutePath): StatusResult {
  if (result.available) return result;
  const root = findWorktreeRoot(cwd);
  return root === null
    ? result
    : { ...result, ...configProblemsOf(root), ...ignoredConfigOf(root, null) };
}

/**
 * The one status line naming them, with the command that checks the config.
 * Row 011-275: an unknown key `ignoredConfigLines` names is left to its line,
 * so no default is said to apply in its place.
 */
export function configProblemsLine(
  result: {
    readonly configProblems?: readonly string[];
    readonly ignoredConfig?: readonly IgnoredConfigRule[];
  },
  command: string,
): string[] {
  const named = new Set(
    (result.ignoredConfig ?? []).filter((r) => r.by === "command").map((r) => unknownKey(r.key)),
  );
  const problems = (result.configProblems ?? []).filter((problem) => !named.has(problem));
  if (problems.length === 0) return [];
  const label = problems.length === 1 ? "Config problem" : "Config problems";
  return [
    `${label}: ${POLICY_FILE}: ${describeProblems(problems)} (\`${command} setup --check\` names each)`,
  ];
}
