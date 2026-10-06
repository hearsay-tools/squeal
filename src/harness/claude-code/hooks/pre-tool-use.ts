import { formatDelta } from "../../../core/delivery/index.js";
import { REGRESSION_KINDS } from "../../../core/types/index.js";
import { isFork } from "../fork.js";
import type { Handler } from "../hook.js";
import { withContext } from "../hook.js";
import { readHookPolicy } from "../policy.js";
import { denialSentence } from "../text.js";

/**
 * PreToolUse on `Edit|Write|NotebookEdit` (D9): with `interrupt.onRegression`
 * on, an undelivered regression denies the edit once. The peek marks only
 * regressions delivered, so recoveries stay for the next PostToolBatch and the
 * same regression never denies twice. One of Claude Code's internal forks is
 * not a consumer, so it is never denied (review wave 6, N4).
 */
export const preToolUse: Handler = async (input, location, deps) => {
  if (isFork(input)) return null;
  return withContext(input, location, deps, async (context) => {
    if (!readHookPolicy(location.root).interrupt.onRegression) return null;
    const delta = await context.delivery.peek(context.consumer, { kinds: REGRESSION_KINDS });
    if (delta === null) return null;
    const tool = input.tool_name ?? "tool";
    return {
      output: {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: `${formatDelta(delta)}\n\n${denialSentence(tool)}`,
        },
      },
    };
  });
};
