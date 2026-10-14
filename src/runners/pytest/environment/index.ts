import type { AbsolutePath, PytestProject } from "../../../core/types/index.js";
import { findPytestConfig, type PytestConfigFile } from "./config.js";
import { type Discovery, projectDir } from "./discover.js";
import { type PytestPlugin, pytestPlugins } from "./entry-points.js";
import { environmentFingerprint, readEnvironmentFiles } from "./fingerprint.js";
import { environmentHash, pytestVariables, runEnvironment } from "./hash.js";
import { type ImportRoots, importRoots } from "./import-roots.js";
import { type InterpreterInfo, queryInterpreter } from "./interpreter.js";
import { readOptional } from "./site.js";
import { type EnvironmentState, environmentState } from "./states.js";

export { findPytestConfig, type PytestConfigFile } from "./config.js";
export { type Discovery, discoverEnvironment, projectDir } from "./discover.js";
export type { PytestPlugin } from "./entry-points.js";
export { environmentFingerprint, readEnvironmentFiles } from "./fingerprint.js";
export { PYTEST_VARIABLES, pytestVariables, runEnvironment } from "./hash.js";
export type { ImportRoots, MappedModule } from "./import-roots.js";
export type { InterpreterInfo } from "./interpreter.js";
export { type EnvironmentState, type OutsideEditable, syncNote } from "./states.js";

/**
 * A pytest project's environment, computed from files and one cached
 * interpreter query (spec 007 D2). Anything but `ready` leaves every check
 * `unknown` with the note; `broken` is an environment whose interpreter
 * does not answer.
 */
export type PytestEnvironment =
  | Exclude<EnvironmentState, { state: "ready" }>
  | { readonly state: "broken"; readonly note: string }
  | {
      readonly state: "ready";
      readonly discovery: Extract<Discovery, { kind: "found" }>;
      readonly interpreter: InterpreterInfo;
      /** D2's runner-side environment hash. */
      readonly hash: string;
      /** Compare before and after a run (`syncNote`). */
      readonly fingerprint: string;
      readonly roots: ImportRoots;
      readonly config: PytestConfigFile | null;
      readonly plugins: readonly PytestPlugin[];
      /** The environment a run spawns pytest with. */
      readonly runEnv: NodeJS.ProcessEnv;
    };

/** D2 end to end for one project: discovery, states, the hash and D4's inputs. */
export async function readEnvironment(
  root: AbsolutePath,
  project: PytestProject,
  source: NodeJS.ProcessEnv = process.env,
): Promise<PytestEnvironment> {
  const state = environmentState(root, project);
  if (state.state !== "ready") return state;
  const { discovery } = state;
  const answer = await queryInterpreter(discovery.python);
  if (!answer.ok) {
    return {
      state: "broken",
      note: `pytest project "${project.name}": ${answer.error}. Its checks stay unknown until the environment's interpreter runs.`,
    };
  }
  const { ok: _, ...interpreter } = answer;
  const files = readEnvironmentFiles(discovery.env, discovery.python);
  const config = findPytestConfig(root, projectDir(root, project));
  const configText = config === null ? null : readOptional(config.path);
  const runEnv = runEnvironment(discovery.env, project, source);
  const roots = importRoots(discovery.env);
  return {
    state: "ready",
    discovery,
    interpreter,
    hash: environmentHash({
      root,
      project,
      files,
      interpreter,
      config,
      configText,
      variables: pytestVariables(runEnv),
    }),
    fingerprint: environmentFingerprint(files),
    roots,
    config,
    plugins: pytestPlugins(roots.sitePackages),
    runEnv,
  };
}
