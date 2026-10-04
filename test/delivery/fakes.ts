import type { StatusBuilder, StatusResult } from "../../src/core/types/index.js";

/**
 * A `StatusBuilder` that returns a fixed result. Stands in for task 001-22's
 * builder until it lands.
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
