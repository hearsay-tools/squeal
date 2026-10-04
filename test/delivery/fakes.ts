import type { StatusBuilder, StatusResult } from "../../src/core/types/index.js";

/**
 * A `StatusBuilder` that returns a fixed result, for delivery tests that do
 * not look at status. `test/status/builder.test.ts` covers the real one.
 */
export function fixedStatus(
  status: StatusResult = {
    schemaVersion: 1,
    available: false,
    reason: "timeout",
    message: "status unavailable: fake",
  },
): StatusBuilder {
  return { build: () => status };
}
