import { DEFAULT_POLICY, type Policy } from "../../src/core/types/index.js";

/*
 * Row 015-64: `complexity.enabled` and `coverage.enabled` default on. Tests
 * that are not about code keep both off, so they count nothing and take no
 * coverage (the coordinator's choice, wave 12).
 */

/** The `squeal.config.json` keys that keep the code features off. */
export const CODE_OFF = {
  complexity: { enabled: false },
  coverage: { enabled: false },
} as const;

/** `DEFAULT_POLICY` with the code features off. */
export const POLICY_CODE_OFF: Policy = {
  ...DEFAULT_POLICY,
  complexity: { ...DEFAULT_POLICY.complexity, enabled: false },
  coverage: { ...DEFAULT_POLICY.coverage, enabled: false },
};
