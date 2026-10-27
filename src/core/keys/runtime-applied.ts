import type { CheckKey, TestFileRef } from "../types/keys.js";
import type { Policy, RuntimeFileApplication } from "../types/policy.js";

/** Applied facts belong to the worktree and key, never the shared closure row. */
export interface AppliedRuntimeReader extends RuntimeFileApplication {
  readonly testFile: TestFileRef;
  readonly key: CheckKey | null;
}
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
