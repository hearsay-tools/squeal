import { stopFork, stopTurn } from "../../shared/stop.js";
import { isFork } from "../fork.js";
import { additionalContext, type Handler } from "../hook.js";

/**
 * Stop and SubagentStop (D9), as `stopTurn` says: a block is Claude Code's
 * `decision: "block"`, news is context that keeps the turn going.
 *
 * Lessons, defect 9: the SubagentStop of one of Claude Code's internal forks
 * never blocks and delivers nothing, because a fork is not a consumer. An
 * empty `agent_type` marks a fork (`fork.ts`). Under `claude --agent <name>`
 * a fork reports `<name>` and is caught only by `stopTurn`'s unregistered
 * SubagentStop rule (review wave 6, S2).
 */
export const stop: Handler = async (input, location, deps) => {
  if (isFork(input)) {
    await stopFork(input, location, deps);
    return null;
  }
  const outcome = await stopTurn(
    { ...input, stopHookActive: input.stop_hook_active === true },
    location,
    deps,
  );
  if (outcome === null) return null;
  if ("block" in outcome) return { output: { decision: "block", reason: outcome.block } };
  return additionalContext(input, outcome.news);
};
