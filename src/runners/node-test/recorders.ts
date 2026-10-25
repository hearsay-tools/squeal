import type { NodeTestProject } from "../../core/types/index.js";
import { ownNodeOptions, UNOBSERVED } from "../process/recorders.js";

/** Settings of 001-132's recorder (`src/runners/observe/runtime.ts`). */
const OBSERVE_VARIABLE = "SQUEAL_OBSERVE";

/**
 * The environment of the project's processes: the inherited one, minus what
 * Squeal itself put there, with the project's `env` merged over it (D1).
 * Dropped: `NODE_TEST_CONTEXT`, from a `node --test` around Squeal, which
 * would make the project's runner act as a child and write no report; and,
 * under a Squeal daemon (task 003-35), Squeal's recorders in `NODE_OPTIONS`,
 * which are no project preload. Its `SQUEAL_OBSERVE` becomes `UNOBSERVED`,
 * so that daemon's recorder stays out of these processes too (task 001-431);
 * a warm-up's own settings replace it. A project's own `env` is kept as
 * written.
 */
export function projectEnv(
  project: NodeTestProject,
  inherited: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const { NODE_TEST_CONTEXT: _, [OBSERVE_VARIABLE]: outer, ...base } = inherited;
  const options = base.NODE_OPTIONS === undefined ? undefined : ownNodeOptions(base.NODE_OPTIONS);
  if (options === undefined) delete base.NODE_OPTIONS;
  else base.NODE_OPTIONS = options;
  if (outer !== undefined) base[OBSERVE_VARIABLE] = UNOBSERVED;
  return { ...base, ...project.env };
}
