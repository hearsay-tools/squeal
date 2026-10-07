import { readPolicy } from "../../../core/daemon/policy.js";
import { formatDelta } from "../../../core/delivery/index.js";
import { resumeTurn } from "../../../core/delivery/turn.js";
import { REGRESSION_KINDS } from "../../../core/types/index.js";
import { isFork } from "../fork.js";
import type { Handler } from "../hook.js";
import { withContext } from "../hook.js";
import { denialSentence } from "../text.js";

/** The tools whose call a regression denies once: the old matcher, `Edit|Write|NotebookEdit`. */
const EDIT_TOOLS: ReadonlySet<string> = new Set(["Edit", "Write", "NotebookEdit"]);

/**
 * PreToolUse on every tool (D9, task 001-93). Any call puts a consumer left
 * idle in a turn before it runs, so the waiter stays silent while another
 * Stop hook's continuation works. On an edit, with `interrupt.onRegression`
 * on, an undelivered regression denies the call once. The peek marks only
 * regressions delivered, so recoveries stay for the next PostToolBatch and the
 * same regression never denies twice; it also puts the consumer in a turn.
 * One of Claude Code's internal forks is not a consumer, so it is never
 * denied and never starts a turn (review wave 6, N4).
 */
export const preToolUse: Handler = async (input, location, deps) => {
  if (isFork(input)) return null;
  return withContext(input, location, deps, async (context) => {
    const edit = EDIT_TOOLS.has(input.tool_name ?? "");
    if (!edit || !readPolicy(location.root).interrupt.onRegression) {
      resumeTurn(context.store, context.consumer);
      return null;
    }
    const delta = await context.delivery.peek(context.consumer, { kinds: REGRESSION_KINDS });
    if (delta === null) return null;
    return {
      output: {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: `${formatDelta(delta)}\n\n${denialSentence(input.tool_name ?? "tool")}`,
        },
      },
    };
  });
};
