import { startSession } from "../../shared/session.js";
import { isFork } from "../fork.js";
import { additionalContext, type Handler } from "../hook.js";

/**
 * SessionStart and SubagentStart (D9): inject what `startSession` returns.
 *
 * Lessons, defect 9: the SubagentStart of one of Claude Code's internal forks
 * does nothing, since a fork is not a consumer.
 */
export const sessionStart: Handler = async (input, location, deps) => {
  if (isFork(input)) return null;
  const text = await startSession(input, location, deps);
  return text === null ? null : additionalContext(input, text);
};
