import type { Policy } from "../../src/core/types/index.js";
import { CODE_OFF } from "./policy.js";

/*
 * Row 011-159 made `baseline.onStart: "lookup-only"` the default (001 D11 as
 * amended 2026-10-23). The scheduler and daemon tests were written when a
 * start ran its misses, so their shared fixtures set that baseline here and
 * a test's start still runs every file no stored result covers. A test of
 * `lookup-only` sets it over this one.
 */

/** `baseline.onStart: "lookup-then-run-missing"`, for a fixture's `Policy`. */
export const RUN_MISSING: Pick<Policy, "baseline"> = {
  baseline: { onStart: "lookup-then-run-missing" },
};

/**
 * A fixture repository's `squeal.config.json` with `RUN_MISSING`, for a real
 * daemon's start: `text` (absent: `{}`) as written when it sets `baseline`
 * or is no JSON object, as a test of a bad config writes it. Row 015-64:
 * with `CODE_OFF` too, unless `text` sets `complexity` or `coverage`.
 */
export function runMissingConfig(text?: string): string {
  let config: unknown = {};
  try {
    if (text !== undefined) config = JSON.parse(text);
  } catch {
    return text ?? "";
  }
  if (typeof config !== "object" || config === null || Array.isArray(config)) return text ?? "";
  const code = "complexity" in config || "coverage" in config ? {} : CODE_OFF;
  if ("baseline" in config) {
    return code === CODE_OFF ? `${JSON.stringify({ ...code, ...config })}\n` : (text ?? "");
  }
  return `${JSON.stringify({ ...RUN_MISSING, ...code, ...config })}\n`;
}
