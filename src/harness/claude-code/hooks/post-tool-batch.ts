import { deliver } from "../../shared/deliver.js";
import { withContext } from "../../shared/hook.js";
import { isFork } from "../fork.js";
import { additionalContext, type Handler } from "../hook.js";

/**
 * PostToolBatch (D9), the primary push channel: the consumer's delta, or
 * nothing, as `deliver` says. One of Claude Code's internal forks is not a
 * consumer, so it is never registered here (review wave 6, N4).
 */
export const postToolBatch: Handler = async (input, location, deps) => {
  if (isFork(input)) return null;
  return withContext(input, location, deps, async (context) => {
    const text = await deliver(context, deps);
    return text === null ? null : additionalContext(input, text);
  });
};
