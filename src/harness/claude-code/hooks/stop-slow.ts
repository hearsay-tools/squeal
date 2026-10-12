import { stopSlow as waitForSlowTier } from "../../shared/stop-slow.js";
import { isFork } from "../fork.js";
import type { Handler } from "../hook.js";

/**
 * The waiting Stop entry beside `stop` (spec 004 D9 as amended 2026-10-12):
 * with `stop.requireSlowSuite` on, a main agent's Stop waits for the slow
 * tier as the shared `stopSlow` says, and a block is Claude Code's
 * `decision: "block"`. Not registered for SubagentStop; a fork says nothing.
 */
export const stopSlow: Handler = async (input, location, deps) => {
  if (isFork(input)) return null;
  const reason = await waitForSlowTier(
    { ...input, stopHookActive: input.stop_hook_active === true },
    location,
    deps,
  );
  return reason === null ? null : { output: { decision: "block", reason } };
};
