import { denyOnRegression } from "../../shared/deny.js";
import { withContext } from "../../shared/hook.js";
import { isFork } from "../fork.js";
import type { Handler } from "../hook.js";

/** The tools whose call a regression denies once: the old matcher, `Edit|Write|NotebookEdit`. */
const EDIT_TOOLS: ReadonlySet<string> = new Set(["Edit", "Write", "NotebookEdit"]);

/**
 * PreToolUse on every tool (D9, task 001-93), as `denyOnRegression` says. One
 * of Claude Code's internal forks is not a consumer, so it is never denied and
 * never starts a turn (review wave 6, N4).
 */
export const preToolUse: Handler = async (input, location, deps) => {
  if (isFork(input)) return null;
  return withContext(input, location, deps, async (context) => {
    const toolName = input.tool_name ?? "";
    const reason = await denyOnRegression(context, {
      edit: EDIT_TOOLS.has(toolName),
      toolName: input.tool_name ?? "tool",
    });
    if (reason === null) return null;
    return {
      output: {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: reason,
        },
      },
    };
  });
};
