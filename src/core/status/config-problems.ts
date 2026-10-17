import { describeProblems } from "../daemon/config-file.js";
import { loadPolicy, POLICY_FILE } from "../daemon/policy.js";
import { findWorktreeRoot } from "../fs/index.js";
import type { AbsolutePath, StatusResult } from "../types/index.js";

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

/** A status unavailable for a worktree adds its config problems; outside a worktree nothing. */
export function withConfigProblems(result: StatusResult, cwd: AbsolutePath): StatusResult {
  if (result.available) return result;
  const root = findWorktreeRoot(cwd);
  return root === null ? result : { ...result, ...configProblemsOf(root) };
}

/** The one status line naming them, with the command that checks the config. */
export function configProblemsLine(
  result: { readonly configProblems?: readonly string[] },
  command: string,
): string[] {
  const problems = result.configProblems ?? [];
  if (problems.length === 0) return [];
  const label = problems.length === 1 ? "Config problem" : "Config problems";
  return [
    `${label}: ${POLICY_FILE}: ${describeProblems(problems)} (\`${command} setup --check\` names each)`,
  ];
}
