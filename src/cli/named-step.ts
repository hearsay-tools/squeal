import { type NextStep, nextStep } from "../core/status/next-step.js";
import type { Standing } from "../core/types/standing.js";

/*
 * Row 011-283: what a named wait says advances a selected file, and the
 * group key that keeps a retry's run on a line of its own. The text lines
 * of `named-file-lines.ts` read both.
 */

/** A retry's run and any other queued file never share a line (row 011-283). */
export function retriedId(standing: Standing): string {
  return standing.kind === "queued" && standing.retried === true ? " retried" : "";
}

/**
 * `nextStep`, with why a retry's run or a named slow file waits (row
 * 011-283, `research/named-wait-rule.md` rule 5): named-wait order leaves
 * both where they were, so the line says what they wait for. The text
 * lines and `--json`'s `reason` both read it.
 */
export function namedStep(standing: Standing): NextStep {
  const next = nextStep(standing);
  if (standing.kind === "queued" && standing.retried === true) {
    return {
      ...next,
      reason: `${next.reason}; ${RETRY_WAITS}`,
      short: `${next.short}; retry: normal priority`,
    };
  }
  if (
    standing.kind === "slow" &&
    standing.pausesOnly !== true &&
    standing.slot === undefined &&
    standing.group === undefined
  ) {
    return {
      ...next,
      reason: next.reason.replace(/^slow, /, `${SLOW_WAITS}, `),
      short: SLOW_WAITS,
    };
  }
  return next;
}

/** A retry's run is forced at the file's normal priority (011 C5). */
const RETRY_WAITS = "retry: normal priority; waits for named groups and edits' work";

/** A named slow file runs after the fast tests (004 D2). */
const SLOW_WAITS = "slow, behind the fast backlog";
