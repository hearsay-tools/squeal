import { readPolicy } from "../../../core/daemon/policy.js";
import { denyCurrentTestCommand, denyOnRegression, testCommandOf } from "../../shared/deny.js";
import { withContext } from "../../shared/hook.js";
import { isFork } from "../fork.js";
import type { Handler } from "../hook.js";

/** The tools whose call a regression denies once: the old matcher, `Edit|Write|NotebookEdit`. */
const EDIT_TOOLS: ReadonlySet<string> = new Set(["Edit", "Write", "NotebookEdit"]);

/**
 * PreToolUse on every tool (D9, task 001-93), as `denyOnRegression` says, then
 * spec 005 D8's opt-in deny of a `Bash` test command Squeal has answered
 * (`denyCurrentTestCommand`), one reason per call. The policy is read and the
 * command recognized before the store opens. One of Claude Code's internal
 * forks is not a consumer, so it is never denied and never starts a turn
 * (review wave 6, N4).
 */
export const preToolUse: Handler = async (input, location, deps) => {
  if (isFork(input)) return null;
  const policy = readPolicy(location.root);
  const toolName = input.tool_name ?? "";
  const testCommand = testCommandOf(location, policy, {
    toolName,
    cwd: input.cwd,
    ...(input.command === undefined ? {} : { command: input.command }),
  });
  return withContext(input, location, deps, async (context) => {
    const reason =
      (await denyOnRegression(context, policy, {
        edit: EDIT_TOOLS.has(toolName),
        toolName: input.tool_name ?? "tool",
      })) ??
      (testCommand === null
        ? null
        : denyCurrentTestCommand(context, testCommand, (deps.now ?? Date.now)()));
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
