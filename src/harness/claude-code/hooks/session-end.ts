import { locate } from "../context.js";
import { type Handler, withContext } from "../hook.js";
import { unregisterSession } from "../sweep.js";

/**
 * SessionEnd (D9): unregister the session's consumers, the main agent and
 * every subagent, and remove waiter lock files no waiter holds. SessionEnd
 * carries no `agent_id`, and a subagent ends with its session.
 *
 * Lessons, defect 5: one `/exit` left its consumer registered. So the hook
 * ignores `reason` (every reason ends the session), never consults or starts
 * the daemon, looks the session up in every worktree of the store, and also
 * sweeps the store of `CLAUDE_PROJECT_DIR` when the session's cwd moved to
 * another repository. A SessionEnd that still misses is caught by the next
 * SessionStart of the same session id, or by daemon-side expiry (D10).
 */
export const sessionEnd: Handler = async (input, location, deps) => {
  const locations = [location];
  const project = deps.env.CLAUDE_PROJECT_DIR;
  const fromProject = project === undefined || project === "" ? null : locate(project);
  if (fromProject !== null && fromProject.commonDir !== location.commonDir) {
    locations.push(fromProject);
  }
  for (const at of locations) {
    await withContext(input, at, deps, async (context) => {
      await unregisterSession(context, input.session_id, { removeLocks: true });
      return null;
    });
  }
  return null;
};
