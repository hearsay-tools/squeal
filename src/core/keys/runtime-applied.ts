import type { AppliedRuntimeReader, Policy } from "../types/policy.js";

export interface AppliedRuntimeFiles {
  readonly signature: string;
  readonly readers: readonly AppliedRuntimeReader[];
  readonly notes: readonly string[];
}
export const runtimeAppliedKey = (worktreeId: string): string => `runtimeFiles.${worktreeId}`;

/** Configuration identity for offline pending detection; order and duplicate rules are irrelevant. */
export function runtimePolicySignature(policy: Policy): string {
  const rules = policy.runtimeFiles.map((rule) =>
    JSON.stringify([
      rule.project,
      [...new Set(rule.tests)].sort(),
      [...new Set(rule.paths)].sort(),
    ]),
  );
  return JSON.stringify([[...new Set(rules)].sort(), policy.inputs]);
}
