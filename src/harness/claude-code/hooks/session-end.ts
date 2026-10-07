import { locate } from "../../shared/context.js";
import { endSession } from "../../shared/session.js";
import type { Handler } from "../hook.js";

/**
 * SessionEnd (D9), as `endSession` says. Lessons, defect 5: the hook also
 * sweeps the store of `CLAUDE_PROJECT_DIR` when the session's cwd moved to
 * another repository.
 */
export const sessionEnd: Handler = async (input, location, deps) => {
  const locations = [location];
  const project = deps.env.CLAUDE_PROJECT_DIR;
  const fromProject = project === undefined || project === "" ? null : locate(project);
  if (fromProject !== null && fromProject.commonDir !== location.commonDir) {
    locations.push(fromProject);
  }
  await endSession(input, locations, deps);
  return null;
};
