import { submitPrompt } from "../../shared/prompt.js";
import { additionalContext, type Handler } from "../hook.js";
import { isInteractive } from "./waiter.js";

/**
 * UserPromptSubmit (task 001-47; lessons, defects 8 and 10). hooks.json arms
 * the idle waiter beside it, because Claude Code runs no Stop after an
 * interrupted turn. The prompt carries what `submitPrompt` returns; only an
 * interactive session registers here. `-p` mode registers nothing here: its
 * SessionStart and first PostToolBatch register and inject the header, and a
 * waiter never runs there, so nothing expires it early.
 */
export const userPromptSubmit: Handler = async (input, location, deps) => {
  const text = await submitPrompt(input, location, deps, { register: isInteractive(deps.env) });
  return text === null ? null : additionalContext(input, text);
};
